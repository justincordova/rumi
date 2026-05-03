import type { IncomingMessage } from "node:http";
import { logger } from "@/lib/logger";

/** Max guest WS connection attempts per IP per minute. */
const LIMIT = 10;
/** Window length. */
const WINDOW_MS = 60_000;
/** How often we sweep stale buckets out of the map. */
const CLEANUP_INTERVAL_MS = 5 * 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(ip);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for this.
  cleanupTimer.unref?.();
}

/**
 * Returns the IP to bucket on. Trusts `x-forwarded-for` only when the server
 * itself is configured behind a proxy (Fastify already sets `trustProxy: true`,
 * which implies the operator vouches for the upstream). Falls back to the
 * socket remote address.
 */
function ipFor(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Token is present iff the client passed an Authorization-equivalent. */
function hasAuthToken(req: IncomingMessage): boolean {
  // Hocuspocus's web client transports the token via the
  // Sec-WebSocket-Protocol header (it's also the documented hook). A real
  // JWT is base64url-encoded and starts with the header `eyJ`.
  const proto = req.headers["sec-websocket-protocol"];
  const protocols = Array.isArray(proto) ? proto : (proto?.split(",") ?? []).map((p) => p.trim());
  for (const p of protocols) {
    if (p.startsWith("eyJ")) return true;
  }
  // Some clients pass it as a query parameter.
  if (req.url?.includes("token=eyJ")) return true;
  return false;
}

/**
 * Returns true if the request should be allowed; false if it's been
 * rate-limited. Authenticated upgrades skip the limit entirely.
 *
 * In-memory only — single-instance MVP. When horizontal scaling ships this
 * moves to Redis (see misc-deferred.md).
 */
export function checkGuestRateLimit(req: IncomingMessage): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  if (hasAuthToken(req)) return { allowed: true, retryAfterSeconds: 0 };

  startCleanup();

  const ip = ipFor(req);
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > LIMIT) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    logger.warn({ ip, count: bucket.count }, "guest ws rate limit exceeded");
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Reset for tests. */
export function _resetGuestRateLimit(): void {
  buckets.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

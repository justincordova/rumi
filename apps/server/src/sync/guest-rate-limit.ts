import type { IncomingMessage } from "node:http";
import { env } from "@/lib/env";
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
 * Returns the IP to bucket on. This runs on the raw HTTP upgrade event before
 * Fastify processes the request, so Fastify's trustProxy setting is not yet
 * applied here — we have to honor it ourselves.
 *
 * When TRUST_PROXY_HOPS is 0 (no proxy in front), trust ONLY the socket
 * address. An attacker hitting the server directly cannot otherwise rotate
 * fake IPs via X-Forwarded-For to bypass the per-IP limit.
 *
 * When TRUST_PROXY_HOPS is N≥1, walk the XFF chain from the right (the most
 * recent hop, i.e. the proxy closest to us) by N entries to find the real
 * client IP. The leftmost entry is attacker-controlled if the chain is
 * shorter than expected.
 */
function ipFor(req: IncomingMessage): string {
  const sockIp = req.socket.remoteAddress ?? "unknown";
  if (env.TRUST_PROXY_HOPS === 0) return sockIp;

  const xff = req.headers["x-forwarded-for"];
  const xffStr = Array.isArray(xff) ? xff.join(",") : xff;
  if (typeof xffStr !== "string" || xffStr.length === 0) return sockIp;
  const parts = xffStr
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return sockIp;
  // Walk from the right by TRUST_PROXY_HOPS hops. If there aren't enough
  // entries (chain is shorter than configured), fall back to the leftmost
  // entry as the best-available client IP.
  const idx = Math.max(0, parts.length - env.TRUST_PROXY_HOPS);
  return parts[idx] ?? sockIp;
}

/** Token is present iff the client passed an Authorization-equivalent. */
function hasAuthToken(req: IncomingMessage): boolean {
  // The Hocuspocus client (`@hocuspocus/provider`) sends its auth token as a
  // protocol-level message AFTER the WebSocket handshake — so at upgrade time
  // it isn't visible here unless the client also surfaces it some other way.
  // Our web client mirrors the JWT into the `?token=` query param specifically
  // so this check works (see apps/web/src/components/editor/yjs-doc-cache.ts).
  // A real JWT is base64url-encoded and starts with the header `eyJ`.
  if (req.url?.includes("token=eyJ")) return true;
  // Also accept tokens in Sec-WebSocket-Protocol for non-Hocuspocus clients
  // (e.g. CLI tools or custom transports that follow the Bearer-as-subprotocol
  // convention).
  const proto = req.headers["sec-websocket-protocol"];
  const protocols = Array.isArray(proto) ? proto : (proto?.split(",") ?? []).map((p) => p.trim());
  for (const p of protocols) {
    if (p.startsWith("eyJ")) return true;
  }
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

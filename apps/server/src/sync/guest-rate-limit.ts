import type { IncomingMessage } from "node:http";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** Max guest (no token) WS connection attempts per IP per minute. */
const LIMIT = 10;
/**
 * Max attempts per IP per minute for upgrades that carry a JWT-shaped token.
 * The shape check is NOT a signature verification (that happens later in
 * `onAuthenticate`), so an attacker can mint a JWT-shaped string and would
 * otherwise get an unbounded exemption. A legitimate authenticated client
 * opens at most a handful of sockets (control doc + one per tab) per page
 * load, so this higher-but-bounded ceiling leaves them ample headroom while
 * still capping a forged-token flood.
 */
const AUTHED_LIMIT = 60;
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
  // Walk from the right by TRUST_PROXY_HOPS hops. If the chain is SHORTER
  // than expected, fall back to the socket address (the actual TCP peer) —
  // the leftmost XFF entry is attacker-controlled in that case and trusting
  // it would let a client behind the proxy spoof their source IP.
  if (parts.length < env.TRUST_PROXY_HOPS) return sockIp;
  const idx = parts.length - env.TRUST_PROXY_HOPS;
  return parts[idx] ?? sockIp;
}

// A JWT-shape sniff (not a verify): three base64url segments joined by `.`,
// header section starts with `eyJ`. This is purely an upgrade-time heuristic
// to skip the per-IP guest cap for authenticated clients; the real auth
// happens later in `onAuthenticate`. We deliberately require the `.` so a
// query value like `?bypass=eyJanything` can't slip through.
const JWT_SHAPE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Token is present iff the client passed an Authorization-equivalent. */
function hasAuthToken(req: IncomingMessage): boolean {
  // The Hocuspocus client (`@hocuspocus/provider`) sends its auth token as a
  // protocol-level message AFTER the WebSocket handshake — so at upgrade time
  // it isn't visible here unless the client also surfaces it some other way.
  // Our web client sets a non-secret `?auth=1` presence flag specifically so
  // this check works without leaking the JWT into request URLs/logs (see
  // apps/web/src/components/editor/yjs-doc-cache.ts).
  if (req.url) {
    try {
      // The base only matters because URL needs an absolute form; we never
      // use the origin. Parsing properly avoids substring-match bypasses
      // (e.g. `?other=auth=1`).
      const parsed = new URL(req.url, "http://x");
      if (parsed.searchParams.get("auth") === "1") return true;
      // Legacy: older clients mirrored the JWT into `?token=`. Honor the
      // shape check during rolling deploys so they keep the higher cap.
      // (Carries no security weight — it only selects which bucket cap
      // applies, and the cap is bounded either way; see checkGuestRateLimit.)
      const tok = parsed.searchParams.get("token");
      if (tok && JWT_SHAPE.test(tok)) return true;
    } catch {
      // malformed URL — fall through and treat as unauthenticated
    }
  }
  // Also accept tokens in Sec-WebSocket-Protocol for non-Hocuspocus clients
  // (e.g. CLI tools or custom transports that follow the Bearer-as-subprotocol
  // convention).
  const proto = req.headers["sec-websocket-protocol"];
  const protocols = Array.isArray(proto) ? proto : (proto?.split(",") ?? []).map((p) => p.trim());
  for (const p of protocols) {
    if (JWT_SHAPE.test(p)) return true;
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
  startCleanup();

  // A JWT-shaped token gets a higher cap but is NEVER fully exempt: the shape
  // sniff is bypassable (no signature verification here), so a blanket
  // exemption would let an attacker rotate forged tokens for unlimited
  // upgrade attempts and defeat the only per-IP defense for raw WS upgrades.
  const limit = hasAuthToken(req) ? AUTHED_LIMIT : LIMIT;

  const ip = ipFor(req);
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    logger.warn({ ip, count: bucket.count, limit }, "ws rate limit exceeded");
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

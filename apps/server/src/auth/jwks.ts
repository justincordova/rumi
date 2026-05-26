import { env } from "@/lib/env";
import { createRemoteJWKSet } from "jose";

export const JWKS = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL), {
  cacheMaxAge: 10 * 60 * 1000, // 10 min
  cooldownDuration: 30 * 1000, // 30s on unknown kid (key rotation window)
  // Bound JWKS fetch latency so a slow upstream can't stall every JWT
  // verification (and therefore every WS upgrade) waiting on the network.
  // Default in jose is 5000ms; setting explicitly to document intent.
  timeoutDuration: 5_000,
});

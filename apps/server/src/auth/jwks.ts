import { env } from "@/lib/env";
import { createRemoteJWKSet } from "jose";

export const JWKS = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL), {
  cacheMaxAge: 10 * 60 * 1000, // 10 min
  cooldownDuration: 30 * 1000, // 30s on unknown kid (key rotation window)
});

import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    DATABASE_URL: z.string().url(),
    SUPABASE_JWKS_URL: z.string().url(),
    SUPABASE_JWT_ISSUER: z.string().url(),
    SUPABASE_JWT_AUDIENCE: z.string().default("authenticated"),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    WS_PUBLIC_ORIGIN: z.string().url().optional(),
    WEB_URL: z.string().url().default("http://localhost:5173"),
    PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
    STRIPE_PRICE_MAX_MONTHLY: z.string().optional(),
    STRIPE_PRICE_MAX_YEARLY: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("Rumi <noreply@mail.rumi.app>"),
    UNSUBSCRIBE_HMAC_SECRET: z.string().min(32).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SENTRY_DSN: z.string().url().optional(),
    // Number of trusted proxy hops in front of the server. Used by Fastify's
    // trustProxy to decide how far to walk X-Forwarded-For. Set to 1 for a
    // single load balancer (most cloud setups), 2 for an LB behind a CDN.
    // 0 disables proxy trust entirely. Defaults to 0 — production deployments
    // behind a proxy must set this explicitly so we don't accidentally trust
    // attacker-spoofed X-Forwarded-For headers when running without a proxy.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  })
  .refine((d) => !d.RESEND_API_KEY || d.UNSUBSCRIBE_HMAC_SECRET, {
    message: "UNSUBSCRIBE_HMAC_SECRET is required when RESEND_API_KEY is set",
    path: ["UNSUBSCRIBE_HMAC_SECRET"],
  })
  .refine((d) => d.NODE_ENV !== "production" || d.SUPABASE_SERVICE_ROLE_KEY, {
    message:
      "SUPABASE_SERVICE_ROLE_KEY is required in production (whitelist invitee notifications, kick auto-blacklist, member email lookups all silently no-op without it)",
    path: ["SUPABASE_SERVICE_ROLE_KEY"],
  })
  .refine((d) => d.NODE_ENV !== "production" || !d.STRIPE_SECRET_KEY || d.STRIPE_WEBHOOK_SECRET, {
    message:
      "STRIPE_WEBHOOK_SECRET is required in production when STRIPE_SECRET_KEY is set — webhook signature verification fails closed and the billing webhook returns 503 without it, so subscription updates never reach the database",
    path: ["STRIPE_WEBHOOK_SECRET"],
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  console.error("Invalid environment variables:", errors);
  // process.exit kills the Bun test worker and produces unnamed test failures
  // with no source attribution. Throw instead so the error is reported
  // against the actual file that triggered the import.
  throw new Error(`Invalid environment variables: ${JSON.stringify(errors)}`);
}

export const env = parsed.data;
export type Env = typeof env;

if (env.NODE_ENV === "production" && env.WEB_URL.includes("localhost")) {
  console.warn(
    "WARNING: WEB_URL contains 'localhost' in production — emails will contain broken links.",
  );
}

// Dev-only: warn if features that depend on the service role key will silently
// no-op. In production this is enforced as a hard requirement above.
if (env.NODE_ENV !== "production" && !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "WARNING: SUPABASE_SERVICE_ROLE_KEY is not set. The following features will silently no-op:\n" +
      "  - whitelist invitee in-app notifications\n" +
      "  - member email lookup for kick auto-blacklist\n" +
      "  - member dedup by email when adding to whitelist\n" +
      "  - user profile lookups for transfer ownership and member list",
  );
}

if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
  console.warn(
    "WARNING: RESEND_API_KEY is not set in production. Transactional emails (access granted, invite accepted) will be logged to stdout instead of delivered.",
  );
}

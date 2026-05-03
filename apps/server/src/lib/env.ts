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
  })
  .refine((d) => !d.RESEND_API_KEY || d.UNSUBSCRIBE_HMAC_SECRET, {
    message: "UNSUBSCRIBE_HMAC_SECRET is required when RESEND_API_KEY is set",
    path: ["UNSUBSCRIBE_HMAC_SECRET"],
  })
  .refine((d) => d.NODE_ENV !== "production" || d.SUPABASE_SERVICE_ROLE_KEY, {
    message:
      "SUPABASE_SERVICE_ROLE_KEY is required in production (whitelist invitee notifications, kick auto-blacklist, member email lookups all silently no-op without it)",
    path: ["SUPABASE_SERVICE_ROLE_KEY"],
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

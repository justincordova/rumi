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
  })
  .refine((d) => !d.RESEND_API_KEY || d.UNSUBSCRIBE_HMAC_SECRET, {
    message: "UNSUBSCRIBE_HMAC_SECRET is required when RESEND_API_KEY is set",
    path: ["UNSUBSCRIBE_HMAC_SECRET"],
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

if (env.NODE_ENV === "production" && env.WEB_URL.includes("localhost")) {
  console.warn(
    "WARNING: WEB_URL contains 'localhost' in production — emails will contain broken links.",
  );
}

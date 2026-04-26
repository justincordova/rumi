import { z } from "zod";

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().default(""),
  VITE_SUPABASE_ANON_KEY: z.string().default(""),
  VITE_WS_URL: z.string().default("ws://localhost:3001/sync"),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
export type Env = typeof env;

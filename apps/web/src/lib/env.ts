import { z } from "zod";

const Env = z.object({
  VITE_API_URL: z.string().url(),
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_WS_URL: z.string().default("ws://localhost:3000/ws"),
});

export const env = Env.parse(import.meta.env);
export type Env = typeof env;

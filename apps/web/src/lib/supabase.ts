import { env } from "@/lib/env";
import { createClient } from "@supabase/supabase-js";

const url = env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = env.VITE_SUPABASE_ANON_KEY || "placeholder";

export const supabase = createClient(url, anonKey);

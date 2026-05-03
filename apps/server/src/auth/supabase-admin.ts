import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// The global `Response` type drifts between bun-types and @types/node depending
// on the dep resolution order. We only need .ok and .json() — assert minimal
// shape locally.
interface MinimalResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export async function lookupUserIdByEmail(email: string): Promise<string | null> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const origin = new URL(env.SUPABASE_JWT_ISSUER).origin;
    const lower = email.toLowerCase();
    const res = (await fetch(
      `${origin}/auth/v1/admin/users?per_page=100&filter=email.eq.${encodeURIComponent(lower)}`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    )) as unknown as MinimalResponse;
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users: Array<{ id: string; email?: string }>;
    };
    const match = data.users.find((u) => u.email?.toLowerCase() === lower);
    return match?.id ?? null;
  } catch (err) {
    logger.debug({ err, email }, "supabase admin lookup failed");
    return null;
  }
}

export async function getUserProfile(
  userId: string,
): Promise<{ email: string; displayName: string | null; avatarUrl: string | null } | null> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const origin = new URL(env.SUPABASE_JWT_ISSUER).origin;
    const res = (await fetch(`${origin}/auth/v1/admin/users/${userId}`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })) as unknown as MinimalResponse;
    if (!res.ok) return null;
    const data = (await res.json()) as {
      email: string;
      user_metadata?: Record<string, unknown>;
    };
    const meta = data.user_metadata;
    const email = data.email?.trim();
    if (!email) return null;
    return {
      email,
      displayName: (meta?.displayName as string) ?? (meta?.full_name as string) ?? null,
      avatarUrl: (meta?.avatar_url as string) ?? (meta?.avatarUrl as string) ?? null,
    };
  } catch (err) {
    logger.debug({ err, userId }, "supabase admin profile lookup failed");
    return null;
  }
}

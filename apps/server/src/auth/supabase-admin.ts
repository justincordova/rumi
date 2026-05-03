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

/**
 * Update a Supabase user's `user_metadata`. Returns true on success, false if
 * the service-role key isn't configured or the update fails.
 */
export async function updateUserMetadata(
  userId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const origin = new URL(env.SUPABASE_JWT_ISSUER).origin;
    const res = (await fetch(`${origin}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_metadata: metadata }),
      // biome-ignore lint/suspicious/noExplicitAny: see MinimalResponse comment above
    } as any)) as unknown as MinimalResponse;
    return res.ok;
  } catch (err) {
    logger.warn({ err, userId }, "supabase admin metadata update failed");
    return false;
  }
}

/**
 * Delete a Supabase user. Returns true on success or if the user is already
 * gone, false if the service-role key isn't configured or the delete fails.
 */
export async function deleteUser(userId: string): Promise<boolean> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const origin = new URL(env.SUPABASE_JWT_ISSUER).origin;
    const res = (await fetch(`${origin}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      // biome-ignore lint/suspicious/noExplicitAny: see MinimalResponse comment above
    } as any)) as unknown as MinimalResponse;
    return res.ok;
  } catch (err) {
    logger.warn({ err, userId }, "supabase admin delete failed");
    return false;
  }
}

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// The global `Response` type drifts between bun-types and @types/node depending
// on the dep resolution order. We only need .ok and .json() — assert minimal
// shape locally.
interface MinimalResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

/**
 * Reverse-lookup a user id by email. Returns null when the service-role key
 * isn't configured (graceful dev stub) or when no user matches. THROWS on
 * transport/HTTP failures so callers that use the result as a security guard
 * (e.g. addToBlacklist's admin-vs-admin check) can fail closed instead of
 * treating an outage as "no such user". Callers that are fine with
 * best-effort semantics attach `.catch(() => null)` at the call site.
 */
export async function lookupUserIdByEmail(email: string): Promise<string | null> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const origin = new URL(env.SUPABASE_JWT_ISSUER).origin;
  const lower = email.toLowerCase();
  // GoTrue's admin `filter` param is a plain substring (ILIKE) match on
  // email/phone — NOT PostgREST `column.op.value` syntax. Passing
  // `email.eq.<addr>` matches nothing, silently breaking every consumer
  // (whitelist notifications, blacklist auto-kick, email dedup on WS auth).
  // Pass the bare address and rely on the exact-match post-filter below.
  const res = (await fetch(
    `${origin}/auth/v1/admin/users?per_page=100&filter=${encodeURIComponent(lower)}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  )) as unknown as MinimalResponse;
  if (!res.ok) {
    logger.debug({ email }, "supabase admin lookup returned non-ok status");
    throw new Error("supabase admin user lookup failed");
  }
  const data = (await res.json()) as {
    users: Array<{ id: string; email?: string }>;
  };
  const match = data.users.find((u) => u.email?.toLowerCase() === lower);
  return match?.id ?? null;
}

// In-process LRU for getUserProfile results. listMembers, addToWhitelist,
// transferOwnership and account-delete all hit this in tight loops. Without
// caching, a 50-member room's "Members" panel burns 50 admin requests per
// open and quickly trips Supabase's per-key rate limit (~100/min).
// 60s TTL keeps the panel responsive while still letting display-name edits
// propagate within a minute.
type ProfileCacheEntry = {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  expiresAt: number;
};
const PROFILE_CACHE_TTL_MS = 60_000;
const PROFILE_CACHE_MAX = 5_000;
const profileCache = new Map<string, ProfileCacheEntry>();

function setProfileCache(userId: string, entry: ProfileCacheEntry) {
  if (profileCache.size >= PROFILE_CACHE_MAX) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  profileCache.set(userId, entry);
}

/** Test/admin-only: invalidate a user's profile cache after we mutate metadata. */
export function invalidateUserProfileCache(userId: string): void {
  profileCache.delete(userId);
}

export async function getUserProfile(
  userId: string,
): Promise<{ email: string; displayName: string | null; avatarUrl: string | null } | null> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const now = Date.now();
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return { email: cached.email, displayName: cached.displayName, avatarUrl: cached.avatarUrl };
  }

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
    // Runtime type guards: user_metadata comes from Supabase as untyped JSON.
    // A non-string value (object, number) cast to `string` would propagate
    // into emails, awareness state, and notification payloads.
    const asString = (v: unknown): string | null =>
      typeof v === "string" && v.trim().length > 0 ? v : null;
    const profile = {
      email,
      displayName: asString(meta?.displayName) ?? asString(meta?.full_name) ?? null,
      avatarUrl: asString(meta?.avatar_url) ?? asString(meta?.avatarUrl) ?? null,
    };
    setProfileCache(userId, { ...profile, expiresAt: now + PROFILE_CACHE_TTL_MS });
    return profile;
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
    if (res.ok) invalidateUserProfileCache(userId);
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
    if (res.ok) invalidateUserProfileCache(userId);
    return res.ok;
  } catch (err) {
    logger.warn({ err, userId }, "supabase admin delete failed");
    return false;
  }
}

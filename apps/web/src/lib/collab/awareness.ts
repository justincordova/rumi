import type { SessionUser } from "@/lib/auth";

// Awareness fields the client may set. Identity (`user_id`) and `color` are
// always overwritten by the server from the verified JWT (or hashed socketId
// for guests). Clients may supply only the cosmetic fields below.
export interface LocalAwareness {
  display_name?: string;
  avatar_url?: string | null;
}

// `guestId` is accepted for API compatibility but intentionally unused — the
// server stamps a guest identifier from the socket id, not from a client value.
export function buildLocalAwareness(user: SessionUser | null, _guestId?: string): LocalAwareness {
  if (!user) {
    return { display_name: "Guest" };
  }
  return {
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
  };
}

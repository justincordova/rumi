import type { SessionUser } from "@/lib/auth";

export interface LocalAwareness {
  user_id?: string;
  display_name?: string;
  avatar_url?: string | null;
  color?: string;
}

function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const palette = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#8b5cf6"] as const;
  return palette[Math.abs(h) % palette.length];
}

export function buildLocalAwareness(user: SessionUser | null, guestId?: string): LocalAwareness {
  if (!user) {
    const id = guestId ? `guest:${guestId}` : undefined;
    return { user_id: id, display_name: "Guest" };
  }
  return {
    user_id: user.id,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    color: colorFor(user.id),
  };
}

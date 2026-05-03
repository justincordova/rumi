export interface AwarenessPayloadClient {
  display_name?: string;
  avatar_url?: string | null;
  /** Drawing-tab pointer position. Omitted on non-drawing tabs and when read-only. */
  cursor?: { x: number; y: number; pageId: string };
}

export interface AwarenessPayloadServer extends AwarenessPayloadClient {
  user_id: string; // server-stamped
  color: string; // server-stamped
}

// Deterministic color hash from user_id; 5 presence colors from design tokens.
export function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % 5;
  return `hsl(var(--presence-${idx + 1}))`;
}

/**
 * Resolves the trusted identity for a given Hocuspocus connection context.
 * Signed-in users get their verified user.id; guests get a stable per-socket id
 * derived from the (server-issued) socketId. Clients cannot influence either.
 */
export function trustedIdentityFor(
  ctx: { user?: { id?: string } } | null | undefined,
  socketId: string,
): string {
  const userId = ctx?.user?.id;
  if (userId) return userId;
  return `guest:${socketId}`;
}

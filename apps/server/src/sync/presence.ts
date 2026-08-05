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

/**
 * Presence palette, mirroring `--color-presence-1..5` in
 * `apps/web/src/styles/globals.css`. Keep the two in sync.
 *
 * These are concrete colors, not CSS custom-property references. The previous
 * value — `hsl(var(--presence-N))` — named a custom property that does not
 * exist (the tokens are `--color-presence-N`) and wrapped a hex literal in
 * `hsl()`, which is not valid syntax either. The declaration was therefore
 * invalid at computed-value time everywhere it landed: the presence avatar
 * fallback resolved to `transparent` (and, being an inline style, also
 * defeated the `bg-muted` class behind it), leaving white initials invisible
 * on the light theme, and tldraw's remote cursors lost their per-user color.
 * A literal color also works in the non-CSS contexts this value reaches, such
 * as tldraw's SVG cursors.
 */
export const PRESENCE_COLORS = ["#1e66f5", "#40a02b", "#fe640b", "#ea76cb", "#df8e1d"] as const;

// Deterministic color hash from user_id.
export function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % PRESENCE_COLORS.length;
  // biome-ignore lint/style/noNonNullAssertion: idx is bounded by the array length
  return PRESENCE_COLORS[idx]!;
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

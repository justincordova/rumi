export interface AwarenessPayloadClient {
  display_name?: string;
  avatar_url?: string | null;
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

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type Channel = "invite_received" | "invite_accepted" | "all";

export function signUnsubscribeToken(userId: string, channel: Channel): string | null {
  if (!env.UNSUBSCRIBE_HMAC_SECRET) return null;
  const payload = `${userId}:${channel}`;
  const sig = createHmac("sha256", env.UNSUBSCRIBE_HMAC_SECRET).update(payload).digest("base64url");
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): { userId: string; channel: Channel } | null {
  if (!env.UNSUBSCRIBE_HMAC_SECRET) return null;
  const dotIdx = token.indexOf(".");
  if (dotIdx === -1) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", env.UNSUBSCRIBE_HMAC_SECRET)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const colonIdx = payload.indexOf(":");
  if (colonIdx === -1) return null;
  const userId = payload.slice(0, colonIdx);
  const channel = payload.slice(colonIdx + 1);
  if (
    !userId ||
    (channel !== "invite_received" && channel !== "invite_accepted" && channel !== "all")
  )
    return null;
  return { userId, channel: channel as Channel };
}

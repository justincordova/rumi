import { AppError } from "@/lib/errors";
import { MAX_ROOMS_OPEN, getUserPlan } from "@/rooms/plan";
import type { onAuthenticatePayload } from "@hocuspocus/server";

/**
 * Identity of the connection currently being authenticated.
 *
 * IMPORTANT: We can't read this from `data.context` because Hocuspocus only
 * merges the `onAuthenticate` return value into `hookPayload.context` AFTER
 * the hook chain resolves (see hocuspocus-server.esm.js:2123-2131). At the
 * time `enforceConnectionLimits` runs — inside the wrapper, before the wrapper
 * returns — `data.context` is still the empty `defaultContext`. So the auth
 * result is passed in explicitly.
 */
export interface ConnectingIdentity {
  roomId: string;
  roomOwner: string;
  userId?: string;
  guestId?: string;
}

export async function enforceConnectionLimits(
  data: onAuthenticatePayload,
  identity: ConnectingIdentity,
) {
  const { roomId, roomOwner, userId, guestId } = identity;
  const selfId = userId ?? guestId ?? null;

  const allDocs = Array.from(data.instance.documents.values());

  // --- Concurrent users per room ---
  // Enforced on EVERY document connection (control doc + tab docs). Enforcing
  // only on the control doc let a custom client connect straight to tab
  // documents — which is all editing requires — with unlimited concurrency.
  // The self-exclusion below keeps the web client's normal flow (control doc
  // first, then one connection per open tab) from double-counting.
  const uniqueUsers = new Set<string>();
  for (const doc of allDocs) {
    for (const conn of doc.getConnections()) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const connCtx = conn.context as any;
      if (connCtx?.roomId !== roomId) continue;
      const uid = connCtx.user?.id ?? connCtx.guestId ?? conn.socketId;
      uniqueUsers.add(uid);
    }
  }
  // If the connecting identity is already counted (second browser tab, a
  // reconnect racing its stale socket, or a tab doc following the control
  // doc), admitting it adds no new unique user — never reject it, even at
  // capacity. Only a genuinely new identity is checked against the cap; it
  // would become the (N+1)th, so `>= maxConcurrentUsers` is correct.
  const alreadyPresent = selfId !== null && uniqueUsers.has(selfId);
  if (!alreadyPresent) {
    const ownerPlan = await getUserPlan(roomOwner);
    if (uniqueUsers.size >= ownerPlan.maxConcurrentUsers) {
      throw new AppError(
        "plan_limit_reached",
        "Room is full. The owner needs to upgrade for more concurrent users.",
        403,
      );
    }
  }

  // --- Rooms open simultaneously (JWT users only) ---
  // Hard safety cap across all tiers; guests are exempt because they don't
  // have a stable identity to count across rooms.
  if (!userId) return;

  const userRooms = new Set<string>();
  for (const doc of allDocs) {
    for (const conn of doc.getConnections()) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const connCtx = conn.context as any;
      if (connCtx?.user?.id === userId && connCtx.roomId) {
        userRooms.add(connCtx.roomId);
      }
    }
  }
  // Reconnecting to an already-open room opens no new room — skip the check.
  if (!userRooms.has(roomId) && userRooms.size >= MAX_ROOMS_OPEN) {
    throw new AppError("room_limit", "Too many rooms open. Close some tabs and try again.", 403);
  }
}

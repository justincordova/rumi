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
  // Only enforce on control doc connections (room:<roomId>). Tab doc
  // connections are spawned after the control doc and share the same room —
  // counting them would double-count users.
  if (!data.documentName.startsWith("room:")) return;

  const { roomId, roomOwner, userId } = identity;

  const allDocs = Array.from(data.instance.documents.values());

  // --- Concurrent users per room ---
  // Count unique users across ALL documents for this room (control + tabs)
  // by looking at each connection's context (set when its own auth finished).
  // The connecting user is NOT yet in `instance.documents` — they become the
  // Nth, so `>= maxConcurrentUsers` is correct.
  const ownerPlan = await getUserPlan(roomOwner);
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
  if (uniqueUsers.size >= ownerPlan.maxConcurrentUsers) {
    throw new AppError(
      "plan_limit_reached",
      "Room is full. The owner needs to upgrade for more concurrent users.",
      403,
    );
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
  if (userRooms.size >= MAX_ROOMS_OPEN) {
    throw new AppError("room_limit", "Too many rooms open. Close some tabs and try again.", 403);
  }
}

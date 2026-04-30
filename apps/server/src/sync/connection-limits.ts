import { AppError } from "@/lib/errors";
import { MAX_ROOMS_OPEN, getUserPlan } from "@/rooms/plan";
import type { onAuthenticatePayload } from "@hocuspocus/server";

export async function enforceConnectionLimits(data: onAuthenticatePayload) {
  // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
  const ctx = data.context as any;
  const roomId: string | undefined = ctx.roomId;
  if (!roomId) return;

  if (!data.documentName.startsWith("room:")) return;

  const instance = data.instance;
  const allDocs = Array.from(instance.documents.values());

  const ownerPlan = await getUserPlan(ctx.roomOwner as string);

  const uniqueUsers = new Set<string>();
  for (const doc of allDocs) {
    for (const conn of doc.getConnections()) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const connCtx = conn.context as any;
      if (connCtx.roomId !== roomId) continue;
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

  const userId: string | undefined = ctx.user?.id;
  if (!userId) return;

  const userRooms = new Set<string>();
  for (const doc of allDocs) {
    for (const conn of doc.getConnections()) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const connCtx = conn.context as any;
      if (connCtx.user?.id === userId && connCtx.roomId) {
        userRooms.add(connCtx.roomId);
      }
    }
  }
  if (userRooms.size >= MAX_ROOMS_OPEN) {
    throw new AppError("room_limit", "Too many rooms open. Close some tabs and try again.", 403);
  }
}

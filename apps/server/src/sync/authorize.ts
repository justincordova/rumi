import { verifyJwt } from "@/auth/verify";
import { db } from "@/db/client";
import { roomMembers, rooms, tabs } from "@/db/schema";
import { AuthError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { onAuthenticatePayload } from "@hocuspocus/server";
import { and, eq, isNull } from "drizzle-orm";

export async function onAuthenticate(payload: onAuthenticatePayload) {
  const { token, documentName } = payload;

  // A real JWT always starts with the base64url-encoded header "eyJ"
  if (token?.startsWith("eyJ")) {
    return authenticateJwt(token, documentName);
  }
  return authenticateGuest(documentName);
}

async function authenticateJwt(token: string, documentName: string) {
  try {
    const user = await verifyJwt(token);

    let tabId: string | null = null;
    let roomId: string;

    if (documentName.startsWith("room:")) {
      roomId = documentName.slice(5);
    } else {
      const tab = await db.query.tabs.findFirst({ where: eq(tabs.id, documentName) });
      if (!tab) throw new AuthError("not_found", "Tab not found");
      tabId = tab.id;
      roomId = tab.roomId;
    }

    const room = await db.query.rooms.findFirst({
      where: and(eq(rooms.id, roomId), isNull(rooms.deletedAt)),
    });
    if (!room) throw new AuthError("not_found", "Room not found");

    const member = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id)),
    });

    if (!member) {
      if (room.visibility === "open") {
        // Auto-join: insert member row; ignore race with another concurrent join
        await db
          .insert(roomMembers)
          .values({ roomId: room.id, userId: user.id, role: "member" })
          .onConflictDoNothing();
      } else {
        throw new AuthError("forbidden", "Not a member");
      }
    }

    logger.info({ userId: user.id, roomId: room.id, tabId, documentName }, "ws authenticated");

    return { user, roomId: room.id, tabId, readOnly: false };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    logger.warn({ err, documentName }, "ws auth: jwt verify failed");
    throw new AuthError("unauthorized", "Invalid token");
  }
}

async function authenticateGuest(documentName: string) {
  let tabId: string | null = null;
  let roomId: string;

  if (documentName.startsWith("room:")) {
    roomId = documentName.slice(5);
  } else {
    const tab = await db.query.tabs.findFirst({ where: eq(tabs.id, documentName) });
    if (!tab) throw new AuthError("not_found", "Tab not found");
    tabId = tab.id;
    roomId = tab.roomId;
  }

  const room = await db.query.rooms.findFirst({
    where: and(eq(rooms.id, roomId), isNull(rooms.deletedAt)),
  });
  if (!room) throw new AuthError("not_found", "Room not found");

  if (room.guestAccess === "none") {
    throw new AuthError("forbidden", "Sign in required");
  }

  const readOnly = room.guestAccess === "view";

  logger.info({ roomId: room.id, tabId, readOnly, documentName }, "ws guest authenticated");

  return { isGuest: true, roomId: room.id, tabId, readOnly };
}

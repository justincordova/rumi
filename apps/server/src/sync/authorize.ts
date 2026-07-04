import { lookupUserIdByEmail } from "@/auth/supabase-admin";
import { verifyJwt } from "@/auth/verify";
import { db } from "@/db/client";
import { roomBlacklist, roomMembers, roomWhitelist, rooms, tabs } from "@/db/schema";
import { AuthError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { onAuthenticatePayload } from "@hocuspocus/server";
import { and, eq, isNull, sql } from "drizzle-orm";

// Standard UUID v1-v8 form. `documentName` is client-supplied, so we shape-
// check before passing to the DB — Postgres would otherwise throw
// "invalid input syntax for type uuid" inside the query and surface as a
// generic auth failure with no diagnostic value, or worse, leak details via
// the error path.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDocumentName(documentName: string): { roomId?: string; tabId?: string } | null {
  if (documentName.startsWith("room:")) {
    const roomId = documentName.slice(5);
    return UUID_RE.test(roomId) ? { roomId } : null;
  }
  return UUID_RE.test(documentName) ? { tabId: documentName } : null;
}

export async function onAuthenticate(payload: onAuthenticatePayload) {
  const { token, documentName } = payload;

  const parsed = parseDocumentName(documentName);
  if (!parsed) {
    throw new AuthError("not_found", "Invalid document");
  }

  // A real JWT always starts with the base64url-encoded header "eyJ"
  if (token?.startsWith("eyJ")) {
    return authenticateJwt(token, parsed);
  }
  return authenticateGuest(parsed, token);
}

async function authenticateJwt(token: string, parsed: { roomId?: string; tabId?: string }) {
  try {
    const user = await verifyJwt(token);

    let tabId: string | null = null;
    let roomId: string;

    if (parsed.roomId) {
      roomId = parsed.roomId;
    } else {
      // biome-ignore lint/style/noNonNullAssertion: parseDocumentName guarantees one of roomId|tabId
      const tab = await db.query.tabs.findFirst({ where: eq(tabs.id, parsed.tabId!) });
      if (!tab) throw new AuthError("not_found", "Tab not found");
      tabId = tab.id;
      roomId = tab.roomId;
    }

    const room = await db.query.rooms.findFirst({
      where: and(eq(rooms.id, roomId), isNull(rooms.deletedAt)),
    });
    if (!room) throw new AuthError("not_found", "Room not found");

    // Check blacklist (initial check). The auto-join paths below re-check
    // blacklist inside their transaction to close the window between this
    // check and the membership insert — see comments in rooms/service.ts.
    const blacklisted = await db.query.roomBlacklist.findFirst({
      where: and(
        eq(roomBlacklist.roomId, room.id),
        sql`lower(${roomBlacklist.email}) = lower(${user.email})`,
      ),
    });
    if (blacklisted) throw new AuthError("forbidden", "Access denied");

    const member = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id)),
    });

    if (!member) {
      if (room.visibility === "open") {
        const existingByEmail = await findMemberByEmail(db, room.id, user.id, user.email);
        if (existingByEmail) {
          return { user, roomId: room.id, tabId, readOnly: false, roomOwner: room.ownerId };
        }
        // Wrap the membership insert in a tx that re-checks blacklist so a
        // concurrent admin add-to-blacklist between our check at line 63 and
        // the insert below can't leave the user with a member row in a room
        // they're blacklisted from.
        await db.transaction(async (tx) => {
          const stillBlacklisted = await tx.query.roomBlacklist.findFirst({
            where: and(
              eq(roomBlacklist.roomId, room.id),
              sql`lower(${roomBlacklist.email}) = lower(${user.email})`,
            ),
          });
          if (stillBlacklisted) throw new AuthError("forbidden", "Access denied");
          await tx
            .insert(roomMembers)
            .values({ roomId: room.id, userId: user.id, role: "member" })
            .onConflictDoNothing();
        });
      } else {
        // Private room — check whitelist
        const whitelisted = await db.query.roomWhitelist.findFirst({
          where: and(
            eq(roomWhitelist.roomId, room.id),
            sql`lower(${roomWhitelist.email}) = lower(${user.email})`,
          ),
        });
        if (!whitelisted) throw new AuthError("forbidden", "No access to this room");
        // Same blacklist-race protection as the open branch above.
        await db.transaction(async (tx) => {
          const stillBlacklisted = await tx.query.roomBlacklist.findFirst({
            where: and(
              eq(roomBlacklist.roomId, room.id),
              sql`lower(${roomBlacklist.email}) = lower(${user.email})`,
            ),
          });
          if (stillBlacklisted) throw new AuthError("forbidden", "Access denied");
          await tx
            .insert(roomMembers)
            .values({ roomId: room.id, userId: user.id, role: "member" })
            .onConflictDoNothing();
        });
      }
    }

    logger.info({ userId: user.id, roomId: room.id, tabId }, "ws authenticated");

    return { user, roomId: room.id, tabId, readOnly: false, roomOwner: room.ownerId };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    logger.warn({ err }, "ws auth: jwt verify or room lookup failed");
    throw new AuthError("unauthorized", "Invalid token");
  }
}

async function authenticateGuest(parsed: { roomId?: string; tabId?: string }, token?: string) {
  let tabId: string | null = null;
  let roomId: string;

  if (parsed.roomId) {
    roomId = parsed.roomId;
  } else {
    // biome-ignore lint/style/noNonNullAssertion: parseDocumentName guarantees one of roomId|tabId
    const tab = await db.query.tabs.findFirst({ where: eq(tabs.id, parsed.tabId!) });
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

  // The web client sends its per-browser guest UUID as the connect token for
  // anonymous sessions. Adopt it as a stable identity for concurrent-user
  // counting so one guest with the control doc + several tab docs open counts
  // as one participant, not one per socket. Namespaced with "guest:" so a
  // client-supplied value can never collide with (or impersonate) a verified
  // userId in the counting sets. Non-UUID tokens fall back to undefined —
  // per-socket counting, the conservative direction.
  const guestId = token && UUID_RE.test(token) ? `guest:${token.toLowerCase()}` : undefined;

  logger.debug({ roomId: room.id, tabId, readOnly, guestId }, "ws guest authenticated");

  return { isGuest: true, guestId, roomId: room.id, tabId, readOnly, roomOwner: room.ownerId };
}

async function findMemberByEmail(
  db: typeof import("@/db/client")["db"],
  roomId: string,
  currentUserId: string,
  email: string,
): Promise<boolean> {
  // Reverse-lookup the email to a single userId (one Supabase admin call),
  // then check membership in the DB. Replaces the previous N+1 pattern that
  // fetched every member's profile sequentially on every WS auth — under
  // load that serialized connection-establishment behind dozens of admin
  // round-trips.
  const candidate = await lookupUserIdByEmail(email).catch(() => null);
  if (!candidate || candidate === currentUserId) return false;
  const member = await db.query.roomMembers.findFirst({
    where: and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, candidate)),
    columns: { userId: true },
  });
  return !!member;
}

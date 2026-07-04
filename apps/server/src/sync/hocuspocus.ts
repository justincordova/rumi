import { db } from "@/db/client";
import { rooms, tabs } from "@/db/schema";
import { logger } from "@/lib/logger";
import { Server } from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import { onAuthenticate } from "./authorize";
import { enforceConnectionLimits } from "./connection-limits";
import { buildDatabaseExtension } from "./persistence";
import { colorFor, trustedIdentityFor } from "./presence";

// Per-room throttle for the rooms.updated_at "last activity" touch on every
// ws connect. Without this, 50 users connecting to a popular room produces a
// write storm on a single row (and contention on every reconnection wave).
// 60s is fine-grained enough for the dashboard "last activity" view.
const ROOM_TOUCH_INTERVAL_MS = 60_000;
// Cap entry count so a long-lived process never accumulates a huge map of
// stale roomIds (active rooms refresh their timestamp on every connect, so
// the LRU eviction below targets the truly idle ones).
const ROOM_TOUCH_MAX_ENTRIES = 10_000;
const lastRoomTouch = new Map<string, number>();

function recordRoomTouch(roomId: string, ts: number) {
  // Genuine LRU behavior: deleting + re-setting moves the key to the end of
  // insertion order, so the oldest *touched* entry is always at the front and
  // gets evicted when we hit the cap. Without the delete, a hot room set
  // early would stay at the front and get evicted, while idle rooms set
  // recently would survive.
  if (lastRoomTouch.has(roomId)) {
    lastRoomTouch.delete(roomId);
  } else if (lastRoomTouch.size >= ROOM_TOUCH_MAX_ENTRIES) {
    const oldest = lastRoomTouch.keys().next().value;
    if (oldest !== undefined) lastRoomTouch.delete(oldest);
  }
  lastRoomTouch.set(roomId, ts);
}

export function buildHocuspocus() {
  return Server.configure({
    extensions: [buildDatabaseExtension()],

    async onAuthenticate(data) {
      const result = await onAuthenticate(data);
      // Hocuspocus only merges the return value into `data.context` AFTER
      // this hook resolves, so we pass the identity explicitly rather than
      // reading from `data.context` (which is still empty here).
      await enforceConnectionLimits(data, {
        roomId: result.roomId,
        roomOwner: result.roomOwner,
        userId: "user" in result ? result.user.id : undefined,
        guestId: "guestId" in result ? result.guestId : undefined,
      });
      return result;
    },

    async onLoadDocument({ context, document }) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const ctx = context as any;
      if (!ctx?.roomId || ctx.tabId) return;

      const arr = document.getArray("tabs");
      if (arr.length > 0) return;

      try {
        const rows = await db
          .select()
          .from(tabs)
          .where(eq(tabs.roomId, ctx.roomId))
          .orderBy(tabs.ordinal);

        if (rows.length > 0) {
          arr.insert(
            0,
            rows.map((t) => ({
              id: t.id,
              roomId: t.roomId,
              type: t.type,
              language: t.language,
              name: t.name,
              ordinal: t.ordinal,
              createdAt: t.createdAt.toISOString(),
              updatedAt: t.updatedAt.toISOString(),
            })),
          );
        }
      } catch (err) {
        logger.error(
          { err, roomId: ctx.roomId, docName: document.name },
          "failed to load tabs into control doc",
        );
      }
    },

    // Identity stamping: clients may submit only cosmetic fields (display_name,
    // avatar_url). user_id and color are always derived from the verified
    // connection context and overwritten if a client tries to spoof them.
    //
    // We mutate awareness.states for the offending clientIds and emit an
    // "update" so Hocuspocus broadcasts the corrected state to all peers
    // (including the spoofer). The check is idempotent — once the state
    // matches the trusted values, the next pass is a no-op, breaking the
    // recursion that would otherwise be triggered by the re-emit.
    async onAwarenessUpdate({ awareness, added, updated, document }) {
      try {
        const changedClients = [...(added ?? []), ...(updated ?? [])];
        if (changedClients.length === 0) return;

        const ownerByClient = new Map<number, { context: unknown; socketId: string }>();
        for (const entry of document.connections.values()) {
          for (const clientId of entry.clients) {
            ownerByClient.set(clientId, {
              context: entry.connection.context,
              socketId: entry.connection.socketId,
            });
          }
        }

        const corrected: number[] = [];
        for (const clientId of changedClients) {
          const owner = ownerByClient.get(clientId);
          if (!owner) continue;

          const state = awareness.states.get(clientId);
          if (!state) continue;

          // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
          const trustedId = trustedIdentityFor(owner.context as any, owner.socketId);
          const trustedColor = colorFor(trustedId);

          if (state.user_id === trustedId && state.color === trustedColor) continue;

          awareness.states.set(clientId, {
            ...state,
            user_id: trustedId,
            color: trustedColor,
          });
          const meta = awareness.meta.get(clientId);
          awareness.meta.set(clientId, {
            clock: (meta?.clock ?? 0) + 1,
            lastUpdated: Date.now(),
          });
          corrected.push(clientId);
        }

        if (corrected.length > 0) {
          // null connectionInstance signals a server-originated awareness change
          // so Hocuspocus' handleAwarenessUpdate broadcasts to every connection.
          awareness.emit("update", [{ added: [], updated: corrected, removed: [] }, null]);
        }
      } catch (err) {
        logger.error({ err, docName: document.name }, "awareness identity stamping failed");
      }
    },

    async onStoreDocument({ context, document }) {
      if (!context) return;
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const ctx = context as any;
      logger.debug(
        { tabId: ctx.tabId, roomId: ctx.roomId, docName: document.name },
        "store document",
      );
    },

    async connected({ context, connectionInstance }) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const ctx = context as any;
      logger.debug(
        { userId: ctx.user?.id, guestId: ctx.guestId, roomId: ctx.roomId, tabId: ctx.tabId },
        "ws connect",
      );
      try {
        connectionInstance.sendStateless(
          JSON.stringify({ type: "session", readOnly: !!ctx.readOnly }),
        );
      } catch (err) {
        // Connection may have closed between auth completing and this hook
        // running; don't let the failure abort the room-touch logic below.
        logger.debug({ err }, "sendStateless(session) failed");
      }
      if (ctx.roomId && !ctx.tabId) {
        const now = Date.now();
        const last = lastRoomTouch.get(ctx.roomId) ?? 0;
        if (now - last >= ROOM_TOUCH_INTERVAL_MS) {
          recordRoomTouch(ctx.roomId, now);
          try {
            await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.id, ctx.roomId));
          } catch (err) {
            // Reset cache on failure so a retry can attempt the write again.
            lastRoomTouch.delete(ctx.roomId);
            logger.warn({ err, roomId: ctx.roomId }, "failed to touch room updatedAt on connect");
          }
        }
      }
    },

    async onDisconnect({ context }) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const ctx = context as any;
      logger.debug(
        { userId: ctx.user?.id, guestId: ctx.guestId, roomId: ctx.roomId, tabId: ctx.tabId },
        "ws disconnect",
      );
    },
  });
}

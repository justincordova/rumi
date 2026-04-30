import { db } from "@/db/client";
import { rooms, tabs } from "@/db/schema";
import { logger } from "@/lib/logger";
import { Server } from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import { onAuthenticate } from "./authorize";
import { buildDatabaseExtension } from "./persistence";
import { colorFor } from "./presence";

export function buildHocuspocus() {
  return Server.configure({
    extensions: [buildDatabaseExtension()],

    onAuthenticate,

    async onLoadDocument({ context, document }) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const ctx = context as any;
      if (!ctx.roomId || ctx.tabId) return;

      const arr = document.getArray("tabs");
      if (arr.length > 0) return;

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
    },

    async onAwarenessUpdate({ awareness, added, updated }) {
      const changedClients = [...(added ?? []), ...(updated ?? [])];
      for (const clientId of changedClients) {
        const state = awareness.states.get(clientId);
        if (!state) continue;

        const uid = state.user_id as string | undefined;
        if (!uid) continue;

        if (!state.color) {
          awareness.states.set(clientId, {
            ...state,
            color: colorFor(uid),
          });
        }
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

    // `connected` fires after auth + initial sync — the connection is ready to receive messages.
    // We use it to push the server-resolved readOnly flag to the client via a stateless message.
    // Also touches rooms.updatedAt on control-doc connections so "last used" stays current.
    async connected({ context, connectionInstance }) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const ctx = context as any;
      logger.debug(
        { userId: ctx.user?.id, guestId: ctx.guestId, roomId: ctx.roomId, tabId: ctx.tabId },
        "ws connect",
      );
      connectionInstance.sendStateless(
        JSON.stringify({ type: "session", readOnly: !!ctx.readOnly }),
      );
      // Touch updatedAt on the room when someone connects to the control doc (not per-tab).
      if (ctx.roomId && !ctx.tabId) {
        await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.id, ctx.roomId));
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

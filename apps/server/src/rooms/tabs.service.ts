import type { DbClient } from "@/db/client";
import { roomMembers, rooms, tabs } from "@/db/schema";
import { AppError, AuthError } from "@/lib/errors";
import { and, eq, sql } from "drizzle-orm";
import { getUserPlan } from "./plan";

export type TabsService = ReturnType<typeof createTabsService>;

export function createTabsService(db: DbClient) {
  // Helper: returns the room + member rows; throws not_found / forbidden.
  // `canEditContent`: any member can mutate the document content of a tab.
  // `canManageTabs`: structural mutations (create / delete / rename / reorder /
  // language change) are owner+admin only.
  async function authorize(slug: string, userId: string) {
    const room = await db.query.rooms.findFirst({
      where: and(eq(rooms.slug, slug), sql`${rooms.deletedAt} IS NULL`),
    });
    if (!room) throw new AuthError("not_found", "Room not found");
    const member = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
    });
    if (!member) throw new AuthError("forbidden", "Not a member");
    const canManageTabs = member.role === "owner" || member.role === "admin";
    return { room, member, canEditContent: true, canManageTabs, userId };
  }

  return {
    async listTabs(slug: string, userId: string) {
      const { room } = await authorize(slug, userId);
      return db.query.tabs.findMany({
        where: eq(tabs.roomId, room.id),
        orderBy: (t, { asc }) => [asc(t.ordinal)],
      });
    },

    async createTab(
      slug: string,
      userId: string,
      body: { type: "tab" | "drawing"; language?: string | null; name?: string },
    ) {
      const { room, canManageTabs } = await authorize(slug, userId);
      if (!canManageTabs) throw new AuthError("forbidden", "Only admins can add tabs");

      if (body.type === "drawing" && body.language) {
        throw new AppError("validation_failed", "Drawing tabs cannot have a language", 422);
      }

      const plan = await getUserPlan(room.ownerId);

      return db.transaction(async (tx) => {
        const existing = await tx
          .select({ ordinal: tabs.ordinal })
          .from(tabs)
          .where(eq(tabs.roomId, room.id))
          .for("update");

        if (existing.length >= plan.maxTabsPerRoom) {
          throw new AppError("tab_limit_reached", `Max ${plan.maxTabsPerRoom} tabs per room`, 422);
        }

        const ordinal = existing.length;

        const [tab] = await tx
          .insert(tabs)
          .values({
            roomId: room.id,
            type: body.type,
            language: body.type === "tab" ? (body.language ?? null) : null,
            name: body.name?.trim() || (body.type === "drawing" ? "Drawing" : "Untitled"),
            ordinal,
          })
          .returning();

        // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
        return tab!;
      });
    },

    async updateTab(
      slug: string,
      userId: string,
      tabId: string,
      body: { name?: string; language?: string | null },
    ) {
      const { room, canManageTabs } = await authorize(slug, userId);
      // updateTab covers rename + language change — both are structural and
      // require admin+ per the role design.
      if (!canManageTabs) throw new AuthError("forbidden", "Only admins can rename tabs");

      const tab = await db.query.tabs.findFirst({
        where: and(eq(tabs.id, tabId), eq(tabs.roomId, room.id)),
      });
      if (!tab) throw new AuthError("not_found", "Tab not found");

      // Validate language against tab type.
      if (body.language !== undefined && tab.type === "drawing" && body.language !== null) {
        throw new AppError("validation_failed", "Drawing tabs cannot have a language", 422);
      }

      const next: Partial<typeof tabs.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) {
        const trimmed = body.name.trim();
        next.name = trimmed.length > 0 ? trimmed : "Untitled";
      }
      if (body.language !== undefined) {
        next.language = body.language;
      }

      const [updated] = await db
        .update(tabs)
        .set(next)
        .where(and(eq(tabs.id, tabId), eq(tabs.roomId, room.id)))
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on UPDATE
      return updated!;
    },

    async reorderTabs(slug: string, userId: string, tabIds: string[]) {
      const { room, canManageTabs } = await authorize(slug, userId);
      if (!canManageTabs) throw new AuthError("forbidden", "Only admins can reorder tabs");

      return db.transaction(async (tx) => {
        const existing = await tx.query.tabs.findMany({
          where: eq(tabs.roomId, room.id),
          orderBy: (t, { asc }) => [asc(t.ordinal)],
        });
        if (existing.length !== tabIds.length) {
          throw new AppError("invalid_state", "Tab list mismatch", 400);
        }
        const existingIds = new Set(existing.map((t) => t.id));
        const seen = new Set<string>();
        for (const id of tabIds) {
          if (!existingIds.has(id) || seen.has(id)) {
            throw new AppError("invalid_state", "Unknown or duplicate tab id", 400);
          }
          seen.add(id);
        }

        // Two-step ordinal swap. Phase 1 moves every target row to a
        // temporary band well above any expected legitimate ordinal so the
        // unique (room_id, ordinal) index can't collide mid-update. Phase 2
        // settles each row to its final 0..N-1 ordinal. Postgres unique
        // indexes are checked per-row at statement end, so as long as
        // neither phase repeats an ordinal across rows of the same room,
        // the swap succeeds.
        const TEMP_BASE = 1_000_000;
        for (let i = 0; i < tabIds.length; i++) {
          await tx
            .update(tabs)
            .set({ ordinal: TEMP_BASE + i })
            .where(eq(tabs.id, tabIds[i] as string));
        }
        for (let i = 0; i < tabIds.length; i++) {
          await tx
            .update(tabs)
            .set({ ordinal: i })
            .where(eq(tabs.id, tabIds[i] as string));
        }
        return tx.query.tabs.findMany({
          where: eq(tabs.roomId, room.id),
          orderBy: (t, { asc }) => [asc(t.ordinal)],
        });
      });
    },

    async deleteTab(slug: string, userId: string, tabId: string) {
      const { room, canManageTabs } = await authorize(slug, userId);
      if (!canManageTabs) throw new AuthError("forbidden", "Only admins can delete tabs");

      return db.transaction(async (tx) => {
        const target = await tx.query.tabs.findFirst({
          where: and(eq(tabs.id, tabId), eq(tabs.roomId, room.id)),
        });
        if (!target) throw new AuthError("not_found", "Tab not found");

        const countResult = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tabs)
          .where(eq(tabs.roomId, room.id));

        const tabCount = countResult[0]?.count ?? 0;

        if (tabCount <= 1) {
          throw new AppError("last_tab", "Cannot delete the last remaining tab", 422);
        }

        await tx.delete(tabs).where(eq(tabs.id, tabId));

        // Re-pack ordinals so they stay contiguous.
        await tx.execute(sql`
          UPDATE ${tabs}
          SET ordinal = ordinal - 1
          WHERE room_id = ${room.id} AND ordinal > ${target.ordinal}
        `);

        return { tabId, roomId: room.id };
      });
    },
  };
}

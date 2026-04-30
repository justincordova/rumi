import type { DbClient } from "@/db/client";
import { roomMembers, rooms, tabs } from "@/db/schema";
import { AppError, AuthError } from "@/lib/errors";
import { and, eq, sql } from "drizzle-orm";
import { getUserPlan } from "./plan";

export type TabsService = ReturnType<typeof createTabsService>;

export function createTabsService(db: DbClient) {
  // Helper: returns the room + member rows; throws not_found / forbidden.
  async function authorize(slug: string, userId: string) {
    const room = await db.query.rooms.findFirst({
      where: and(eq(rooms.slug, slug), sql`${rooms.deletedAt} IS NULL`),
    });
    if (!room) throw new AuthError("not_found", "Room not found");
    const member = await db.query.roomMembers.findFirst({
      where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
    });
    if (!member) throw new AuthError("forbidden", "Not a member");
    return { room, member, canEdit: true, userId };
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
      const { room, canEdit } = await authorize(slug, userId);
      if (!canEdit) throw new AuthError("forbidden", "Read-only access");

      if (body.type === "drawing" && body.language) {
        throw new AppError("validation_failed", "Drawing tabs cannot have a language", 422);
      }

      const plan = await getUserPlan(userId);

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
      const { room, canEdit } = await authorize(slug, userId);
      if (!canEdit) throw new AuthError("forbidden", "Read-only access");

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

    async deleteTab(slug: string, userId: string, tabId: string) {
      const { room, canEdit } = await authorize(slug, userId);
      if (!canEdit) throw new AuthError("forbidden", "Read-only access");

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

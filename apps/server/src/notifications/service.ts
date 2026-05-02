import type { DbClient } from "@/db/client";
import { notificationPreferences, notifications } from "@/db/schema";
import {
  InviteAcceptedPayload,
  InviteReceivedPayload,
  type NotificationPreferences,
} from "@rumi/protocol";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

type NotificationInput =
  | { type: "invite_received"; payload: InviteReceivedPayload }
  | { type: "invite_accepted"; payload: InviteAcceptedPayload };

const DEFAULT_PREFS: NotificationPreferences = {
  emailEnabled: true,
  inviteReceivedEmail: true,
  inviteAcceptedEmail: true,
};

export type NotificationsService = ReturnType<typeof createNotificationsService>;

export function createNotificationsService(db: DbClient) {
  return {
    async recordNotification(userId: string, input: NotificationInput) {
      if (input.type === "invite_received") {
        InviteReceivedPayload.parse(input.payload);
      } else {
        InviteAcceptedPayload.parse(input.payload);
      }
      const [row] = await db
        .insert(notifications)
        .values({
          userId,
          type: input.type,
          payload: input.payload,
        })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
      return row!;
    },

    async listNotifications(userId: string, opts: { limit?: number } = {}) {
      const limit = Math.min(opts.limit ?? 20, 50);
      const items = await db.query.notifications.findMany({
        where: eq(notifications.userId, userId),
        orderBy: [desc(notifications.createdAt)],
        limit,
      });
      const [unread] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
      return { notifications: items, unreadCount: unread?.count ?? 0 };
    },

    async markRead(userId: string, body: { ids: string[] } | { all: true }) {
      if ("all" in body) {
        await db
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
        return;
      }
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            inArray(notifications.id, body.ids),
            isNull(notifications.readAt),
          ),
        );
    },

    async getPreferences(userId: string): Promise<NotificationPreferences> {
      const row = await db.query.notificationPreferences.findFirst({
        where: eq(notificationPreferences.userId, userId),
      });
      return row
        ? {
            emailEnabled: row.emailEnabled,
            inviteReceivedEmail: row.inviteReceivedEmail,
            inviteAcceptedEmail: row.inviteAcceptedEmail,
          }
        : DEFAULT_PREFS;
    },

    async updatePreferences(userId: string, patch: Partial<NotificationPreferences>) {
      await db
        .insert(notificationPreferences)
        .values({ userId, ...DEFAULT_PREFS, ...patch, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { ...patch, updatedAt: new Date() },
        });
      return this.getPreferences(userId);
    },
  };
}

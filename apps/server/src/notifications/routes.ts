import { verifyUnsubscribeToken } from "@/notifications/unsubscribe";
import {
  type InviteAcceptedPayload,
  type InviteReceivedPayload,
  ListNotificationsResponse,
  MarkReadBody,
  type NotificationPreferences,
  type NotificationType,
  UpdateNotificationPreferencesBody,
} from "@rumi/protocol";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

function serializeNotification(row: {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type as NotificationType,
    payload: row.payload as InviteReceivedPayload | InviteAcceptedPayload,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  app.post("/unsubscribe", { config: { rateLimit: false } }, async (req, reply) => {
    const token = (req.query as { token?: string }).token;
    if (!token)
      return reply.code(400).send({ error: { code: "missing_token", message: "Missing token" } });
    const decoded = verifyUnsubscribeToken(token);
    if (!decoded)
      return reply.code(400).send({ error: { code: "invalid_token", message: "Invalid token" } });
    const patch: Partial<NotificationPreferences> =
      decoded.channel === "all"
        ? { emailEnabled: false }
        : decoded.channel === "invite_received"
          ? { inviteReceivedEmail: false }
          : { inviteAcceptedEmail: false };
    await app.notifications.updatePreferences(decoded.userId, patch);
    if (req.headers.accept?.includes("text/html")) {
      return reply
        .type("text/html")
        .send(
          "<!doctype html><html><body><h1>Unsubscribed</h1><p>You have been unsubscribed from these emails.</p></body></html>",
        );
    }
    return { ok: true };
  });

  typed.get(
    "/",
    {
      schema: {
        response: {
          200: ListNotificationsResponse,
        },
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      const result = await app.notifications.listNotifications(req.user!.id, {});
      return {
        notifications: result.notifications.map(serializeNotification),
        unreadCount: result.unreadCount,
      };
    },
  );

  typed.post(
    "/read",
    {
      schema: {
        body: MarkReadBody,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      await app.notifications.markRead(req.user!.id, req.body as { ids: string[] } | { all: true });
      return { ok: true };
    },
  );

  typed.get("/preferences", async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    return { preferences: await app.notifications.getPreferences(req.user!.id) };
  });

  typed.patch(
    "/preferences",
    {
      schema: {
        body: UpdateNotificationPreferencesBody,
      },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      return { preferences: await app.notifications.updatePreferences(req.user!.id, req.body) };
    },
  );
};

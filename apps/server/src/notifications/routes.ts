import { verifyUnsubscribeToken } from "@/notifications/unsubscribe";
import {
  type InviteAcceptedPayload,
  ListNotificationsResponse,
  MarkReadBody,
  type NotificationPreferences,
  type NotificationType,
  type RoomAccessGrantedPayload,
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
  let type = row.type;
  if (type === "invite_received") type = "room_access_granted";
  const typedNotifType = type as NotificationType;
  return {
    id: row.id,
    type: typedNotifType,
    payload: row.payload as RoomAccessGrantedPayload | InviteAcceptedPayload,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // Humans clicking the in-body "Unsubscribe" link in an email issue a GET.
  // Serve a confirmation page whose button POSTs the token — never unsubscribe
  // directly on GET, or mail-client link prefetchers and security scanners
  // would silently unsubscribe users. The RFC 8058 one-click flow (mail
  // clients) POSTs straight to the handler below.
  app.get("/unsubscribe", { config: { rateLimit: false } }, async (req, reply) => {
    const token = (req.query as { token?: string }).token;
    const decoded = token ? verifyUnsubscribeToken(token) : null;
    if (!token || !decoded) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          "<!doctype html><html><body><h1>Invalid link</h1><p>This unsubscribe link is invalid or has expired.</p></body></html>",
        );
    }
    // Token round-trips via the form action's query string. Only HMAC-verified
    // tokens reach this point, and they're base64url — but escape anyway.
    const escaped = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return reply
      .type("text/html")
      .send(
        `<!doctype html><html><body><h1>Unsubscribe</h1><p>Click below to stop receiving these emails.</p><form method="post" action="/api/notifications/unsubscribe?token=${escaped}"><button type="submit">Unsubscribe</button></form></body></html>`,
      );
  });

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
        : decoded.channel === "invite_received" || decoded.channel === "room_access_granted"
          ? { accessGrantedEmail: false }
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

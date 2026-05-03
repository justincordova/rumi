import { accountRoutes } from "@/account/routes";
import authPlugin from "@/auth/plugin";
import { getUserProfile, lookupUserIdByEmail } from "@/auth/supabase-admin";
import { billingRoutes } from "@/billing/routes";
import { webhookRoutes } from "@/billing/webhook";
import { closeDb, db } from "@/db/client";
import { tabs as tabsTable } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError, envelope } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { Sentry, initSentry } from "@/lib/sentry";
import { notificationRoutes } from "@/notifications/routes";
import { createNotificationsService } from "@/notifications/service";
import { startPurgeScheduler } from "@/rooms/purge";
import { roomsRoutes } from "@/rooms/routes";
import { createService } from "@/rooms/service";
import { tabsRoutes } from "@/rooms/tabs.routes";
import { createTabsService } from "@/rooms/tabs.service";
import { subscriptionRoutes } from "@/subscriptions/routes";
import { buildHocuspocus } from "@/sync/hocuspocus";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { WebSocketServer } from "ws";

export async function buildServer() {
  // Initialize Sentry as early as possible. No-op when SENTRY_DSN is unset.
  initSentry();

  const app = Fastify({
    // biome-ignore lint/suspicious/noExplicitAny: Fastify's loggerInstance type is overly strict; pino's Logger is compatible at runtime
    loggerInstance: logger as any,
    disableRequestLogging: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const supabaseOrigin = new URL(env.SUPABASE_JWT_ISSUER).origin;
  const wsOrigins = env.WS_PUBLIC_ORIGIN ? [env.WS_PUBLIC_ORIGIN] : [];

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"], // anti-flash inline script
        "connect-src": ["'self'", supabaseOrigin, ...wsOrigins],
        "img-src": ["'self'", "data:", "https:"],
      },
    },
  });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: false });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  await app.register(formbody);

  // Build Hocuspocus and decorate.
  const hocuspocus = buildHocuspocus();
  app.decorate("hocuspocus", hocuspocus);

  // Decorate with service factories.
  app.decorate("notifications", createNotificationsService(db));
  app.decorate(
    "service",
    createService(db, {
      notifications: app.notifications,
      lookupUserIdByEmail,
      getUserProfile,
    }),
  );
  app.decorate("tabsService", createTabsService(db));

  // Real Hocuspocus-backed implementations.
  app.decorate("closeTabConnections", (tabId: string) => {
    logger.debug({ tabId }, "closing tab ws connections");
    hocuspocus.closeConnections(tabId);
  });
  app.decorate("dropUserConnections", (userId: string) => {
    logger.debug({ userId }, "dropping user ws connections");
    let closed = 0;
    let failed = 0;
    for (const doc of hocuspocus.documents.values()) {
      for (const conn of doc.getConnections()) {
        // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
        const ctx = conn.context as any;
        if (ctx?.user?.id === userId) {
          try {
            conn.close();
            closed++;
          } catch (err) {
            failed++;
            logger.warn(
              { err, userId, documentName: doc.name },
              "failed to close ws connection during user drop",
            );
          }
        }
      }
    }
    if (failed > 0) {
      logger.warn({ userId, closed, failed }, "dropUserConnections completed with failures");
    }
  });
  app.decorate("dropConnectionForUserInRoom", (roomId: string, userId: string) => {
    logger.debug({ roomId, userId }, "dropping user ws connections in room");
    for (const doc of hocuspocus.documents.values()) {
      for (const conn of doc.getConnections()) {
        // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
        const ctx = conn.context as any;
        const match =
          (ctx?.user?.id === userId || ctx?.guestId === userId) && ctx?.roomId === roomId;
        if (match) {
          try {
            conn.sendStateless(JSON.stringify({ type: "kicked" }));
          } catch {
            // best-effort; connection may already be closing
          }
          try {
            conn.close();
          } catch (err) {
            logger.warn(
              { err, userId, roomId, documentName: doc.name },
              "failed to close ws connection during scoped user drop",
            );
          }
        }
      }
    }
  });
  app.decorate("dropRoomConnections", async (roomId: string) => {
    logger.debug({ roomId }, "dropping room ws connections");
    const tabIds = await db
      .select({ id: tabsTable.id })
      .from(tabsTable)
      .where(eq(tabsTable.roomId, roomId));
    for (const { id } of tabIds) {
      hocuspocus.closeConnections(id);
    }
    hocuspocus.closeConnections(`room:${roomId}`);
  });

  await app.register(authPlugin);
  await app.register(
    async (scope) => {
      await scope.register(roomsRoutes);
      await scope.register(tabsRoutes);
    },
    { prefix: "/api/rooms" },
  );
  await app.register(subscriptionRoutes, { prefix: "/api/subscriptions" });
  await app.register(billingRoutes, { prefix: "/api/billing" });
  await app.register(webhookRoutes, { prefix: "/api/billing" });
  await app.register(notificationRoutes, { prefix: "/api/notifications" });
  await app.register(accountRoutes, { prefix: "/api/account" });

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(envelope(err));
    }
    logger.error({ err, reqId: req.id, url: req.url, method: req.method }, "unhandled error");
    if (env.SENTRY_DSN) {
      Sentry.captureException(err, {
        extra: { reqId: req.id, url: req.url, method: req.method },
      });
    }
    return reply.code(500).send(envelope(new AppError("server_error", "Internal error", 500)));
  });

  return app;
}

if (import.meta.main) {
  const app = await buildServer();

  await app.ready();

  // Attach HTTP-upgrade listener for Hocuspocus WebSocket connections.
  // All WebSocket connections go through /ws path.
  const wss = new WebSocketServer({ noServer: true });

  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus expects a ws.WebSocket instance
        app.hocuspocus.handleConnection(ws as any, request);
      } catch (err) {
        logger.error({ err, url: request.url }, "ws handleConnection failed");
        ws.close();
      }
    });
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ port: env.PORT }, "listening");

  // Background tasks. The purge job is opt-in for non-production via env to
  // avoid noisy local dev runs; production always runs it.
  const stopPurge = env.NODE_ENV === "production" ? startPurgeScheduler() : () => {};

  const shutdown = async () => {
    try {
      stopPurge();
      await app.hocuspocus.destroy();
      await app.close();
      await closeDb();
      logger.info("shutdown complete");
    } catch (err) {
      logger.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

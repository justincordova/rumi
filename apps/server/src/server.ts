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
import { checkGuestRateLimit } from "@/sync/guest-rate-limit";
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
    // Walk N trusted proxy hops when extracting client IP. `true` would trust
    // any X-Forwarded-For chain, allowing an attacker who can hit the server
    // directly to spoof their IP and bypass per-IP rate limits. Operators
    // explicitly set TRUST_PROXY_HOPS to the number of LB/CDN hops in front
    // of the app.
    trustProxy: env.TRUST_PROXY_HOPS,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // The API serves JSON only — no HTML response that would benefit from a
  // script-src/style-src policy. Helmet's other defaults (X-Frame-Options,
  // Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy) are
  // useful here, but a CSP on a JSON API is just visual noise that requires
  // 'unsafe-inline' anyway. CSP belongs on the web app.
  await app.register(helmet, { contentSecurityPolicy: false });
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
    // Snapshot the documents map up front — closing a connection can trigger
    // `onDisconnect`, which may delete the doc from the live map mid-iteration
    // and cause us to skip entries.
    const docs = Array.from(hocuspocus.documents.values());
    for (const doc of docs) {
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
    // Only match by the authenticated user id, never the guest socket id —
    // kicks are issued from HTTP routes that pass a userId from `req.user`,
    // so matching `ctx.guestId === userId` here would let a UUID collision
    // (extremely unlikely, but possible) target an arbitrary guest.
    const docs = Array.from(hocuspocus.documents.values());
    for (const doc of docs) {
      for (const conn of doc.getConnections()) {
        // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
        const ctx = conn.context as any;
        if (ctx?.user?.id !== userId || ctx?.roomId !== roomId) continue;
        try {
          conn.sendStateless(JSON.stringify({ type: "kicked" }));
        } catch (err) {
          logger.debug({ err, userId, roomId }, "kick sendStateless failed");
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
    // Parse only the pathname — do NOT construct a URL from the Host header.
    // `new URL(path, `http://${host}`)` throws synchronously on a malformed or
    // missing Host (e.g. `Host: a b`), and an uncaught exception in a raw
    // 'upgrade' listener kills the process. This runs before any auth or rate
    // limiting, so it must never throw on attacker-controlled input.
    const pathname = (request.url ?? "/").split("?")[0];
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    // Validate Origin header. Browser WebSocket upgrades always include an
    // Origin header set by the browser; CORS does NOT apply to WS upgrades,
    // so this is the only same-origin enforcement. Non-browser clients
    // (CLIs, server-to-server) typically omit Origin entirely — we allow
    // those through because they can't be CSRF'd via a victim's browser.
    const origin = request.headers.origin;
    if (origin && origin !== env.WEB_ORIGIN) {
      logger.warn({ origin, expected: env.WEB_ORIGIN }, "ws upgrade rejected: bad origin");
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    // Rate-limit upgrade attempts per IP. Upgrades carrying a JWT-shaped
    // token get a higher cap but are never fully exempt (the shape is not
    // verified here, so a blanket exemption would be trivially forged).
    // @fastify/rate-limit doesn't apply to raw upgrade events so this is the
    // only line of defense.
    const { allowed, retryAfterSeconds } = checkGuestRateLimit(request);
    if (!allowed) {
      socket.write(
        `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfterSeconds}\r\nConnection: close\r\n\r\n`,
      );
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

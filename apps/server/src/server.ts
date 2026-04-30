import authPlugin from "@/auth/plugin";
import { closeDb, db } from "@/db/client";
import { tabs as tabsTable } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError, envelope } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { roomsRoutes } from "@/rooms/routes";
import { createService } from "@/rooms/service";
import { tabsRoutes } from "@/rooms/tabs.routes";
import { createTabsService } from "@/rooms/tabs.service";
import { buildHocuspocus } from "@/sync/hocuspocus";
import cors from "@fastify/cors";
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

  // Build Hocuspocus and decorate.
  const hocuspocus = buildHocuspocus();
  app.decorate("hocuspocus", hocuspocus);

  // Decorate with service factories.
  app.decorate("service", createService(db));
  app.decorate("tabsService", createTabsService(db));

  // Real Hocuspocus-backed implementations.
  app.decorate("closeTabConnections", (tabId: string) => {
    hocuspocus.closeConnections(tabId);
  });
  app.decorate("dropRoomConnections", async (roomId: string) => {
    // Close all live tab connections + the room control doc connection.
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

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(envelope(err));
    }
    logger.error({ err }, "unhandled error");
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
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus expects a ws.WebSocket instance
      app.hocuspocus.handleConnection(ws as any, request);
    });
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`listening on :${env.PORT}`);

  const shutdown = async () => {
    await app.hocuspocus.destroy();
    await app.close();
    await closeDb();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

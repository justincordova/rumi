import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

const app = Fastify({
  loggerInstance: logger,
  disableRequestLogging: false,
  trustProxy: true,
});

await app.register(helmet);
await app.register(cors, {
  origin: env.NODE_ENV === "development",
  credentials: true,
});
await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

app.get("/health", async () => ({
  status: "ok",
  uptime: process.uptime(),
}));

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`listening on :${env.PORT}`);
} catch (err) {
  logger.error(err, "failed to start server");
  process.exit(1);
}

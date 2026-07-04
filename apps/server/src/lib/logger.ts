import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "@/lib/env";
import { multistream, pino, transport } from "pino";

const isDev = env.NODE_ENV === "development";

// The pretty transport (a worker thread) and the append-only log file are
// dev-only conveniences. They must not be created outside development: the
// transport spawns a worker that is never used, the file handle is never
// closed, and mkdirSync/createWriteStream throw at import time on a
// read-only container filesystem — crashing the server before it starts.
function buildDevLogger() {
  const logFilePath = resolve(import.meta.dir, "../../logs/server.log");
  mkdirSync(dirname(logFilePath), { recursive: true });

  const prettyStream = transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  });

  // Append, not truncate — preserve prior debug context across restarts.
  const fileStream = createWriteStream(logFilePath, { flags: "a" });

  return pino({ level: env.LOG_LEVEL }, multistream([prettyStream, fileStream]));
}

export const logger = isDev ? buildDevLogger() : pino({ level: env.LOG_LEVEL });

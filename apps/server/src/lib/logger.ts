import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "@/lib/env";
import { multistream, pino, transport } from "pino";

const isDev = env.NODE_ENV === "development";

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

const fileStream = createWriteStream(logFilePath, { flags: "w" });

export const logger = isDev
  ? pino({ level: env.LOG_LEVEL }, multistream([prettyStream, fileStream]))
  : pino({ level: env.LOG_LEVEL });

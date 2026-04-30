# Logging

## Logger

`apps/server/src/lib/logger.ts` exports a shared `pino` instance. Import it:

```ts
import { logger } from "@/lib/logger";
```

Do not create additional pino instances — use the shared one everywhere.

## Log level

Controlled by the `LOG_LEVEL` env var (defaults to `"info"`). Valid values:
`fatal`, `error`, `warn`, `info`, `debug`, `trace`.

In development, `pino-pretty` formats output with colors and human-readable timestamps.
In production, pino outputs newline-delimited JSON.

## Structured logging

Always pass a structured object as the first argument, followed by the message string:

```ts
logger.info({ userId: user.id, roomId: room.id }, "ws authenticated");
logger.warn({ err, roomId, tabId }, "broadcastTabsCreated failed");
logger.debug({ tabId: ctx.tabId, roomId: ctx.roomId }, "store document");
```

This ensures log entries are machine-parseable (JSON in production) and grep-friendly.

## Level conventions

| Level | When to use |
|---|---|
| `error` | Unhandled exceptions, unexpected failures that need immediate attention (e.g. global error handler). |
| `warn` | Recoverable failures, suspicious behavior, or expected-but-unhappy paths (e.g. JWT verify failed, broadcast failed). |
| `info` | Notable business events — auth successes, server startup. Use sparingly. |
| `debug` | Connection lifecycle (connect, disconnect, store document) and other high-frequency events. Safe to leave in code; silenced by default log level. |

## What not to log

- Never log JWT tokens, passwords, or secrets.
- Never log full request/response bodies.
- Keep PII minimal — user IDs and room IDs are fine; emails and display names should be avoided at `info` level and above.

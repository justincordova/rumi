# Testing

## Running tests

```bash
bun test apps packages   # All tests from repo root
bun test apps/server     # Server tests only
bun test apps/web        # Web tests only
```

## Test setup

`bunfig.toml` preloads `test-setup.ts` for all test runs. It:

- Sets default env vars for server tests (`DATABASE_URL`, `SUPABASE_JWKS_URL`, etc.)
- Registers `happy-dom` as the global DOM environment for React component tests

No per-file setup is needed — `bun test` handles it automatically.

## File conventions

- Tests live **alongside the source** as `<name>.test.ts` (e.g. `service.ts` → `service.test.ts`).
- No `__tests__/` directories.

## Server tests

**Route tests** (e.g. `routes.test.ts`):

- Use `mock.module()` at the top level to stub `@/db/client` and `jose` before importing the server.
- Call `buildServer()` to get a Fastify instance with real route wiring but mocked deps.
- Override `app.service` with `mock()` objects.
- Use `app.inject()` for HTTP-level assertions — no real socket listener.
- Auth is bypassed by mocking `jose.jwtVerify`; pass `Authorization: Bearer valid.token.here` for authenticated routes.

**Service tests** (e.g. `service.test.ts`):

- Create a minimal Drizzle-like stub (`makeDb()`) with chained query builder methods.
- Call `createService(stubDb)` directly — no Fastify involved.

**General:**

- Mock `@hocuspocus/extension-database` in any test file that transitively imports server code, to prevent the Hocuspocus DB extension from leaking across test files (it's a singleton).

## Web tests

- `happy-dom` provides `document`, `window`, etc.
- Zustand stores can be tested directly by importing and calling their methods.
- React component tests use standard `bun:test` (`describe`, `it`, `expect`).

## Protocol tests

`packages/protocol/src/index.test.ts` validates Zod schemas parse correctly and produce the expected TypeScript types.

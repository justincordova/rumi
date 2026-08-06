# Testing

## Running tests

```bash
bun test apps packages   # All tests from repo root
bun test apps/server     # Server tests only
bun test apps/web        # Web tests only
```

## Test setup

`bunfig.toml` preloads `test-setup.ts` for all test runs. It sets default env
vars for server tests (`DATABASE_URL`, `SUPABASE_JWKS_URL`, etc.). No DOM setup.

No per-file setup is needed for env vars — `bun test` handles it automatically.

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

### `mock.module` is global

`mock.module()` replaces a module for the **whole run**, not just the calling
file, and `bun test` discovers files in filesystem order — which differs
between macOS and CI. Consequences:

- **Never `mock.module()` a module that another test file exercises directly.**
  `webhook.test.ts` stubbed `@/billing/service`; when CI happened to load it
  before `billing/service.test.ts`, that file got the stub instead of the real
  implementation and all 13 of its cases asserted against canned values. It
  passed locally the whole time because the local order is reversed.
- Prefer stubbing the **Fastify decorator** at runtime
  (`app.billingService = stub` after `buildServer()`) over stubbing the module.
  This is already how `dropUserConnections` is stubbed.
- When a partial mock is unavoidable, spread the real module first so the other
  exports survive (see the `drizzle-orm` mock in `billing/service.test.ts`).

A test that passes locally but fails in CI is usually this. Note you **cannot**
reproduce it by passing the files to `bun test` in CI's order — bun re-sorts
them internally, so the local order wins regardless. Diagnose it by grepping for
other `mock.module()` calls naming the module under test, and read the failing
assertions: values that look canned (every call returning the same object, tests
finishing in well under a millisecond) mean a stub is being exercised.

## Web tests

- `happy-dom` provides `document`, `window`, etc. Setup is done per-file with
  `beforeAll`/`afterAll` (not in the global preload).
- Zustand stores can be tested directly by importing and calling their methods.
- React component tests use standard `bun:test` (`describe`, `it`, `expect`).

## Protocol tests

`packages/protocol/src/index.test.ts` validates Zod schemas parse correctly and produce the expected TypeScript types.

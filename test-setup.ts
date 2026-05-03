// Root-level test setup — loaded for all bun test runs from the repo root.
// Sets env vars needed by apps/server tests, and registers happy-dom for apps/web tests.

import { afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Server env vars (safe defaults for test execution — not real credentials)
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SUPABASE_JWKS_URL ??= "https://test.supabase.co/auth/v1/.well-known/jwks.json";
process.env.SUPABASE_JWT_ISSUER ??= "https://test.supabase.co/auth/v1";
process.env.NODE_ENV ??= "test";

// happy-dom's BrowserExceptionObserver installs process.on('uncaughtException')
// and process.on('unhandledRejection') listeners. When an unhandled rejection
// fires after tests finish (Zustand persist flush, supabase auth teardown, etc.)
// and no other listeners exist, the observer calls process.exit(1). Bun sees
// this mid-run and records it as unnamed test failures with no file attribution.
//
// Prevent by adding our own no-op listeners. This makes listenerCount exceed
// the observer's static counter, so it skips the forced exit. Async side-effects
// from test teardown can then reject harmlessly.
process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

GlobalRegistrator.register();

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

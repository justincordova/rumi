// Root-level test setup — loaded for all bun test runs from the repo root.
// Sets env vars needed by apps/server tests, and registers happy-dom for apps/web tests.

import { afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Server env vars (safe defaults for test execution — not real credentials)
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SUPABASE_JWKS_URL ??= "https://test.supabase.co/auth/v1/.well-known/jwks.json";
process.env.SUPABASE_JWT_ISSUER ??= "https://test.supabase.co/auth/v1";
process.env.NODE_ENV ??= "test";

GlobalRegistrator.register();

// happy-dom's BrowserExceptionObserver installs process.on('uncaughtException')
// and process.on('unhandledRejection') listeners. When the test worker exits
// and any post-test async work (Zustand persist, supabase auth subscriptions,
// etc.) produces an unhandled rejection, the observer calls process.exit(1)
// if no other listeners are registered. Bun records this as N unnamed test
// failures with no file attribution.
//
// Calling GlobalRegistrator.unregister() disconnects the observer cleanly by
// closing the happy-dom window, which removes those process listeners before
// the worker exits. This is the documented teardown path for happy-dom.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

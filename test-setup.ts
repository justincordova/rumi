// Root-level test setup — loaded for all bun test runs from the repo root.
// Sets env vars needed by apps/server tests, and registers happy-dom for apps-web tests.

import { afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Server env vars (safe defaults for test execution — not real credentials)
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SUPABASE_JWKS_URL ??= "https://test.supabase.co/auth/v1/.well-known/jwks.json";
process.env.SUPABASE_JWT_ISSUER ??= "https://test.supabase.co/auth/v1";
process.env.NODE_ENV ??= "test";

// happy-dom's BrowserExceptionObserver installs process listeners that call
// process.exit(1) on unhandled rejections from post-test async cleanup
// (Zustand persist flush, supabase auth teardown, etc.). Bun's test runner
// sees process.exit(1) and records it as unnamed test failures with no file
// attribution. Monkey-patching process.exit to swallow non-zero codes prevents
// this. The patch stays active for the entire process lifetime because async
// cleanup can fire after all afterAll hooks have completed.
const realExit = process.exit;
process.exit = (code) => {
  if (code !== 0) return undefined as never;
  return realExit(code);
};

GlobalRegistrator.register();

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

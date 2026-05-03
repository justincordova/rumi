// Root-level test setup — loaded for all bun test runs from the repo root.
// Sets env vars needed by apps/server tests.
//
// NOTE: happy-dom is NOT registered globally here. Only the 3 test files that
// actually need DOM APIs (yjs-store.test.ts, drawing-tab.test.tsx, prefs.test.ts)
// register/unregister happy-dom locally via beforeEach/afterEach. Global
// registration causes Bun's test runner to track unhandled rejections from
// happy-dom's BrowserExceptionObserver as unnamed test failures.

// Server env vars (safe defaults for test execution — not real credentials)
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SUPABASE_JWKS_URL ??= "https://test.supabase.co/auth/v1/.well-known/jwks.json";
process.env.SUPABASE_JWT_ISSUER ??= "https://test.supabase.co/auth/v1";
process.env.NODE_ENV ??= "test";

// DEBUG: log unhandled rejections to identify the source of the 3 unnamed
// test failures in CI. Remove after fixing.
process.on("unhandledRejection", (reason) => {
  console.error("[DEBUG-UNHANDLED-REJECTION]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[DEBUG-UNCAUGHT-EXCEPTION]", error);
});

// Root-level test setup — loaded for all bun test runs from the repo root.
// Sets env vars needed by apps/server tests.

// Server env vars (safe defaults for test execution — not real credentials)
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SUPABASE_JWKS_URL ??= "https://test.supabase.co/auth/v1/.well-known/jwks.json";
process.env.SUPABASE_JWT_ISSUER ??= "https://test.supabase.co/auth/v1";
process.env.NODE_ENV ??= "test";

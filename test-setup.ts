// Root-level test setup — loaded for all bun test runs from the repo root.
// Sets env vars needed by apps/server tests, and registers happy-dom for apps/web tests.

// Server env vars (safe defaults for test execution — not real credentials)
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SUPABASE_JWKS_URL ??= "https://test.supabase.co/auth/v1/.well-known/jwks.json";
process.env.SUPABASE_JWT_ISSUER ??= "https://test.supabase.co/auth/v1";
process.env.NODE_ENV ??= "test";

// Web DOM env — happy-dom registers a global DOM for React component tests.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

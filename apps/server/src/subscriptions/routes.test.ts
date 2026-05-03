import { beforeAll, describe, expect, it, mock } from "bun:test";

mock.module("@/db/client", () => ({
  db: {
    query: {
      subscriptions: {
        findFirst: mock(async () => null),
      },
    },
  },
  closeDb: async () => {},
}));

mock.module("jose", () => ({
  createRemoteJWKSet: mock(() => "mock-jwks"),
  jwtVerify: mock(async () => ({
    payload: { sub: "user-id", email: "user@example.com" },
  })),
}));

mock.module("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    PORT: 3000,
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SUPABASE_JWKS_URL: "https://test.supabase.co/auth/v1/.well-known/jwks.json",
    SUPABASE_JWT_ISSUER: "https://test.supabase.co/auth/v1",
    SUPABASE_JWT_AUDIENCE: "authenticated",
    WEB_ORIGIN: "http://localhost:5173",
    WEB_URL: "http://localhost:5173",
    PUBLIC_API_URL: "http://localhost:3000",
  },
}));

const { buildServer } = await import("@/server");

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
});

const authHeader = { authorization: "Bearer valid.token.here" };

describe("GET /api/subscriptions/me", () => {
  it("returns null subscription for user with no row", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/subscriptions/me",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { subscription: null };
    expect(body.subscription).toBeNull();
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/subscriptions/me",
    });
    expect(res.statusCode).toBe(401);
  });
});

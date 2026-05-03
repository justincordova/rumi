import { describe, expect, it, mock } from "bun:test";

// Bun's `mock.module` replaces the module globally and persists across test
// files in the same process. ESM live bindings mean any later read of `env`
// from `@/lib/env` (e.g. inside cached `@/server`) sees this mock object.
// So the env mock here MUST contain every field that any other module reads
// at runtime — otherwise downstream tests that import `@/server` will see
// `env.SUPABASE_JWT_ISSUER === undefined` and crash when constructing URLs.
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
    UNSUBSCRIBE_HMAC_SECRET: "test-secret-that-is-at-least-32-chars!!",
  },
}));

const { signUnsubscribeToken, verifyUnsubscribeToken } = await import("./unsubscribe");

describe("unsubscribe tokens", () => {
  it("sign + verify roundtrip", () => {
    const token = signUnsubscribeToken("user-1", "invite_received");
    const result = verifyUnsubscribeToken(token);
    expect(result).toEqual({ userId: "user-1", channel: "invite_received" });
  });

  it("roundtrips all channels", () => {
    for (const channel of ["invite_received", "invite_accepted", "all"] as const) {
      const token = signUnsubscribeToken("user-1", channel);
      expect(verifyUnsubscribeToken(token)).toEqual({ userId: "user-1", channel });
    }
  });

  it("returns null for tampered token", () => {
    const token = signUnsubscribeToken("user-1", "invite_received");
    const tampered = `${token}x`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("returns null for missing dot separator", () => {
    expect(verifyUnsubscribeToken("nodothere")).toBeNull();
  });

  it("returns null for invalid channel", async () => {
    const { env } = await import("@/lib/env");
    const payload = "user-1:invalid_channel";
    const sig = await import("node:crypto").then((c) =>
      c.createHmac("sha256", env.UNSUBSCRIBE_HMAC_SECRET).update(payload).digest("base64url"),
    );
    const encoded = Buffer.from(payload).toString("base64url");
    const token = `${encoded}.${sig}`;
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });
});

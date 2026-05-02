import { describe, expect, it, mock } from "bun:test";

mock.module("@/lib/env", () => ({
  env: {
    UNSUBSCRIBE_HMAC_SECRET: "test-secret-that-is-at-least-32-chars!!",
    WEB_URL: "http://localhost:5173",
    PUBLIC_API_URL: "http://localhost:3000",
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

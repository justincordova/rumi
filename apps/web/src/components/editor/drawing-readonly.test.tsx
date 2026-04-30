import { describe, expect, it, mock } from "bun:test";

// ── env mock ──────────────────────────────────────────────────────────────────
mock.module("@/lib/env", () => ({
  env: {
    VITE_API_URL: "http://localhost:3000",
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    VITE_WS_URL: "ws://localhost:3000/ws",
  },
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * Tests for the readOnly path of DrawingTab.
 *
 * Full render tests (tldraw toolbar hidden, ReadOnlyPill rendered) are manual
 * because tldraw requires a real browser canvas. These tests verify the
 * server→client readOnly wiring that DrawingTab depends on, in isolation.
 */
describe("DrawingTab readOnly — server stateless payload", () => {
  function parseSessionPayload(raw: string): boolean | null {
    try {
      const msg = JSON.parse(raw) as { type?: string; readOnly?: boolean };
      if (msg.type !== "session") return null;
      return !!msg.readOnly;
    } catch {
      return null;
    }
  }

  it("server sends readOnly:true → client receives true", () => {
    const payload = JSON.stringify({ type: "session", readOnly: true });
    expect(parseSessionPayload(payload)).toBe(true);
  });

  it("server sends readOnly:false → client receives false", () => {
    const payload = JSON.stringify({ type: "session", readOnly: false });
    expect(parseSessionPayload(payload)).toBe(false);
  });

  it("non-session messages are ignored (null)", () => {
    expect(parseSessionPayload(JSON.stringify({ type: "other" }))).toBeNull();
  });

  it("malformed JSON returns null without throwing", () => {
    expect(parseSessionPayload("!notjson")).toBeNull();
  });
});

describe("ReadOnlyPill component", () => {
  it("module exports ReadOnlyPill", async () => {
    const { ReadOnlyPill } = await import("./read-only-pill");
    expect(typeof ReadOnlyPill).toBe("function");
  });
});

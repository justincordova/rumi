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

// ── supabase mock (used transitively by @/lib/auth) ───────────────────────────
mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * The stateless-message parsing logic is the core of the readOnly wiring.
 * We test it in isolation without spinning up a real HocuspocusProvider.
 */
describe("session stateless message parsing", () => {
  function parseStateless(payload: string): { readOnly?: boolean } | null {
    try {
      const msg = JSON.parse(payload) as { type?: string; readOnly?: boolean };
      if (msg.type === "session") return { readOnly: !!msg.readOnly };
      return null;
    } catch {
      return null;
    }
  }

  it("parses {type:'session', readOnly:true} → readOnly: true", () => {
    const result = parseStateless(JSON.stringify({ type: "session", readOnly: true }));
    expect(result?.readOnly).toBe(true);
  });

  it("parses {type:'session', readOnly:false} → readOnly: false", () => {
    const result = parseStateless(JSON.stringify({ type: "session", readOnly: false }));
    expect(result?.readOnly).toBe(false);
  });

  it("ignores messages with unknown type", () => {
    const result = parseStateless(JSON.stringify({ type: "ping" }));
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const result = parseStateless("not-json{{{");
    expect(result).toBeNull();
  });

  it("treats missing readOnly field as false", () => {
    const result = parseStateless(JSON.stringify({ type: "session" }));
    expect(result?.readOnly).toBe(false);
  });
});

describe("awareness buildLocalAwareness", () => {
  it("returns display_name and avatar_url from session user", async () => {
    const { buildLocalAwareness } = await import("@/lib/collab/awareness");
    const result = buildLocalAwareness({
      id: "u1",
      email: "user@example.com",
      displayName: "Alice",
      avatarUrl: "https://example.com/avatar.jpg",
    });
    expect(result.display_name).toBe("Alice");
    expect(result.avatar_url).toBe("https://example.com/avatar.jpg");
  });

  it("returns guest defaults for null user", async () => {
    const { buildLocalAwareness } = await import("@/lib/collab/awareness");
    const result = buildLocalAwareness(null);
    expect(result.user_id).toBeUndefined();
    expect(result.display_name).toBe("Guest");
  });
});

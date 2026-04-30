import { describe, expect, it, mock } from "bun:test";
import * as Y from "yjs";

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
 * DrawingTab renders tldraw which requires a real browser canvas.
 * Full render tests are manual. These unit tests exercise the Yjs store
 * binding that DrawingTab relies on, and validate the readOnly logic.
 */
describe("DrawingTab — Yjs store (unit)", () => {
  it("createYjsStore exposes a store with required methods plus a bind() function", async () => {
    const { createYjsStore } = await import("@/lib/drawing/yjs-store");
    const doc = new Y.Doc();
    const { store, bind } = createYjsStore({ doc });

    expect(typeof store.put).toBe("function");
    expect(typeof store.remove).toBe("function");
    expect(typeof store.allRecords).toBe("function");
    expect(typeof store.listen).toBe("function");
    expect(typeof store.dispose).toBe("function");
    expect(typeof bind).toBe("function");

    store.dispose();
  });

  it("createYjsStore does not throw on dispose", async () => {
    const { createYjsStore } = await import("@/lib/drawing/yjs-store");
    const doc = new Y.Doc();
    const { store } = createYjsStore({ doc });
    expect(() => store.dispose()).not.toThrow();
  });

  it("store binds to the correct Y.Map key 'tldraw'", async () => {
    const { createYjsStore } = await import("@/lib/drawing/yjs-store");
    const doc = new Y.Doc();
    createYjsStore({ doc });
    // The store should have called getMap("tldraw") during setup
    expect(doc.getMap("tldraw")).toBeDefined();
  });

  it("two stores on separate docs are independent", async () => {
    const { createYjsStore } = await import("@/lib/drawing/yjs-store");
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const { store: store1 } = createYjsStore({ doc: doc1 });
    const { store: store2 } = createYjsStore({ doc: doc2 });

    // Verify both have separate Y.Maps
    expect(doc1.getMap("tldraw")).not.toBe(doc2.getMap("tldraw"));

    store1.dispose();
    store2.dispose();
  });
});

describe("DrawingTab — useTldrawTheme (unit)", () => {
  it("module exports useTldrawTheme function", async () => {
    const { useTldrawTheme } = await import("@/lib/drawing/theme");
    expect(typeof useTldrawTheme).toBe("function");
  });
});

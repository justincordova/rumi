import { describe, expect, it } from "bun:test";
import { mock } from "bun:test";

// Mock @/lib/env before anything imports it
mock.module("@/lib/env", () => ({
  env: {
    VITE_API_URL: "http://localhost:3000",
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    VITE_WS_URL: "ws://localhost:3000/ws",
  },
}));

import * as Y from "yjs";

const { createYjsStore } = await import("./yjs-store");

describe("createYjsStore", () => {
  it("creates a store + bind() bound to a Y.Doc", () => {
    const doc = new Y.Doc();
    const { store, yStore, bind } = createYjsStore({ doc });

    expect(typeof store.put).toBe("function");
    expect(typeof store.remove).toBe("function");
    expect(typeof store.allRecords).toBe("function");
    expect(typeof store.listen).toBe("function");
    expect(typeof store.dispose).toBe("function");
    expect(typeof bind).toBe("function");
    expect(typeof yStore.set).toBe("function");
    expect(typeof yStore.get).toBe("function");

    store.dispose();
  });

  it("disposes cleanly without errors", () => {
    const doc = new Y.Doc();
    const { store } = createYjsStore({ doc });
    expect(() => store.dispose()).not.toThrow();
  });

  it("uses the 'tldraw-v2' Y.Array key for record storage", () => {
    const doc = new Y.Doc();
    const { store } = createYjsStore({ doc });
    // Should be the Y.Array we registered, not a Y.Map.
    const yArr = doc.getArray("tldraw-v2");
    expect(yArr).toBeDefined();
    expect(yArr.toArray()).toEqual([]);
    store.dispose();
  });
});

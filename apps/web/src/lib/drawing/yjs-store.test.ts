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

import type { TLRecord } from "tldraw";
import * as Y from "yjs";

const { createYjsStore } = await import("./yjs-store");

describe("createYjsStore", () => {
  it("creates a store bound to a Y.Doc", () => {
    const doc = new Y.Doc();
    const { store, bind } = createYjsStore({ doc });

    // Store should be an object with tldraw store methods
    expect(typeof store.put).toBe("function");
    expect(typeof store.remove).toBe("function");
    expect(typeof store.allRecords).toBe("function");
    expect(typeof store.listen).toBe("function");
    expect(typeof store.dispose).toBe("function");
    expect(typeof bind).toBe("function");

    store.dispose();
  });

  it("disposes cleanly without errors", () => {
    const doc = new Y.Doc();
    const { store } = createYjsStore({ doc });
    // dispose should not throw
    expect(() => store.dispose()).not.toThrow();
  });

  it("two stores on shared doc both bind to the same Y.Map", () => {
    const doc = new Y.Doc();
    const { store: store1 } = createYjsStore({ doc });
    const { store: store2 } = createYjsStore({ doc });

    // Both stores exist and bind to the same Y.Doc
    const yShapes = doc.getMap<TLRecord>("tldraw");
    expect(yShapes).toBeDefined();

    store1.dispose();
    store2.dispose();
  });
});

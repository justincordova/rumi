import { describe, expect, it, mock } from "bun:test";

// Isolate from DB and persistence — these tests use a pure in-memory Hocuspocus.
mock.module("@/db/client", () => ({ db: {} }));
mock.module("@hocuspocus/extension-database", () => ({
  // Stub out the Database extension — no DB in these tests.
  Database: class {},
}));

import { Server } from "@hocuspocus/server";
import type { TabSummary } from "@rumi/protocol";
import * as Y from "yjs";
import {
  broadcastTabsCreated,
  broadcastTabsDeleted,
  broadcastTabsReordered,
  broadcastTabsUpdated,
} from "./control";

const mockTab: TabSummary = {
  id: "00000000-0000-0000-0000-000000000001",
  roomId: "room-001",
  type: "tab",
  language: "markdown",
  name: "Welcome",
  ordinal: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Y.Array mutation behaviour — pure in-process tests, no network.
 * These cover the exact same operations that broadcastTabs* perform internally.
 */
describe("control broadcast logic (pure Yjs)", () => {
  it("push → tab appears in array", () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<TabSummary>("tabs");
    arr.push([mockTab]);
    expect(arr.length).toBe(1);
    expect(arr.get(0)?.id).toBe(mockTab.id);
  });

  it("push then update-by-replace → name changes", () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<TabSummary>("tabs");
    arr.push([mockTab]);

    // Simulate broadcastTabsUpdated internals
    for (let i = 0; i < arr.length; i++) {
      if ((arr.get(i) as TabSummary).id === mockTab.id) {
        arr.delete(i, 1);
        arr.insert(i, [{ ...mockTab, name: "Renamed" }]);
        break;
      }
    }

    expect(arr.get(0)?.name).toBe("Renamed");
  });

  it("push then delete → array is empty", () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<TabSummary>("tabs");
    arr.push([mockTab]);

    // Simulate broadcastTabsDeleted internals
    for (let i = 0; i < arr.length; i++) {
      if ((arr.get(i) as TabSummary).id === mockTab.id) {
        arr.delete(i, 1);
        break;
      }
    }

    expect(arr.length).toBe(0);
  });

  it("delete non-existent id → array unchanged", () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<TabSummary>("tabs");
    arr.push([mockTab]);

    // Simulate broadcastTabsDeleted with a wrong id
    for (let i = 0; i < arr.length; i++) {
      if ((arr.get(i) as TabSummary).id === "does-not-exist") {
        arr.delete(i, 1);
        break;
      }
    }

    expect(arr.length).toBe(1); // unchanged
  });
});

/**
 * Smoke-test that the exported functions exist and accept a Hocuspocus instance.
 * We don't assert on side effects here — the pure-Yjs tests above cover the logic.
 */
describe("control exports", () => {
  it("broadcastTabsCreated is a function", () => {
    expect(typeof broadcastTabsCreated).toBe("function");
  });

  it("broadcastTabsUpdated is a function", () => {
    expect(typeof broadcastTabsUpdated).toBe("function");
  });

  it("broadcastTabsDeleted is a function", () => {
    expect(typeof broadcastTabsDeleted).toBe("function");
  });

  it("broadcastTabsDeleted resolves without throwing for empty room", async () => {
    // Use a minimal Hocuspocus that won't trigger the DB extension.
    const h = Server.configure({});
    await expect(broadcastTabsDeleted(h, "nonexistent-room", "any-id")).resolves.toBeUndefined();
    await h.destroy();
  });
});

/**
 * Regression tests for tab duplication. Run the actual broadcast functions
 * against a real Hocuspocus instance (no DB extension — `mock.module` at the
 * top of this file stubs it). These cover the behavior that the inline-Yjs
 * simulations above can't exercise: the real `openDirectConnection` +
 * `transact` path against a control doc that may already contain entries.
 */
describe("broadcastTabs* deduplication", () => {
  // Each test holds an open direct connection for the lifetime of the case so
  // the control doc stays loaded between broadcast calls. Hocuspocus evicts a
  // doc from memory when its last connection closes — without a held connection
  // each call to `openDirectConnection` would observe a freshly hydrated doc
  // (which in unit tests means an empty doc, since the DB extension is mocked
  // out at the top of this file).
  async function withRoom(
    fn: (h: ReturnType<typeof Server.configure>, roomId: string, doc: Y.Doc) => Promise<void>,
  ) {
    const h = Server.configure({});
    const roomId = `room-${Math.random().toString(36).slice(2, 10)}`;
    const conn = await h.openDirectConnection(`room:${roomId}`);
    let liveDoc: Y.Doc | null = null;
    await conn.transact((doc) => {
      liveDoc = doc;
    });
    if (!liveDoc) throw new Error("failed to acquire live doc");
    try {
      await fn(h, roomId, liveDoc);
    } finally {
      await conn.disconnect();
      await h.destroy();
    }
  }

  it("broadcastTabsCreated is idempotent — repeated calls do not duplicate", async () => {
    await withRoom(async (h, roomId, doc) => {
      await broadcastTabsCreated(h, roomId, mockTab);
      await broadcastTabsCreated(h, roomId, mockTab);
      await broadcastTabsCreated(h, roomId, mockTab);

      const arr = doc.getArray<TabSummary>("tabs").toArray();
      expect(arr).toHaveLength(1);
      expect(arr[0]?.id).toBe(mockTab.id);
    });
  });

  it("broadcastTabsCreated does not re-add a tab that hydration already inserted", async () => {
    // Simulates the production race: onLoadDocument inserted the row from DB
    // (because the row was just persisted by tabsService.createTab), and then
    // broadcastTabsCreated runs on the same doc with the same id.
    await withRoom(async (h, roomId, doc) => {
      // Pre-populate the control doc as if `onLoadDocument` had hydrated it.
      doc.getArray<TabSummary>("tabs").push([mockTab]);

      await broadcastTabsCreated(h, roomId, mockTab);

      const arr = doc.getArray<TabSummary>("tabs").toArray();
      expect(arr).toHaveLength(1);
    });
  });

  it("broadcastTabsDeleted removes ALL copies of a tab id (cleanup of leaked dupes)", async () => {
    await withRoom(async (h, roomId, doc) => {
      doc.getArray<TabSummary>("tabs").push([mockTab, mockTab]);

      await broadcastTabsDeleted(h, roomId, mockTab.id);

      expect(doc.getArray<TabSummary>("tabs").toArray()).toHaveLength(0);
    });
  });

  it("broadcastTabsUpdated replaces one entry and removes any further duplicates", async () => {
    await withRoom(async (h, roomId, doc) => {
      doc.getArray<TabSummary>("tabs").push([mockTab, mockTab]);

      await broadcastTabsUpdated(h, roomId, { ...mockTab, name: "Renamed" });

      const arr = doc.getArray<TabSummary>("tabs").toArray();
      expect(arr).toHaveLength(1);
      expect(arr[0]?.name).toBe("Renamed");
    });
  });

  it("broadcastTabsReordered with empty array is a no-op", async () => {
    // Smoke test only — reorder logic is exercised by tabs.service tests; this
    // just guards against regressions in the broadcast wrapper.
    const h = Server.configure({});
    await expect(broadcastTabsReordered(h, "room-reorder", [])).resolves.toBeUndefined();
    await h.destroy();
  });
});

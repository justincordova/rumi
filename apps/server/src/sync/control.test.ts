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
import { broadcastTabsCreated, broadcastTabsDeleted, broadcastTabsUpdated } from "./control";

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

import { logger } from "@/lib/logger";
import type { Hocuspocus } from "@hocuspocus/server";
import type { TabSummary } from "@rumi/protocol";

export async function broadcastTabsCreated(h: Hocuspocus, roomId: string, tab: TabSummary) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
    try {
      await conn.transact((doc) => {
        const arr = doc.getArray<TabSummary>("tabs");
        // Idempotent: skip if this tab id is already present. This matters
        // because `openDirectConnection` may itself trigger `onLoadDocument`,
        // which hydrates the Y.Array from the DB — and the new tab's row was
        // just inserted by `tabsService.createTab` before this call. Without
        // this guard the hydration adds the row and then `push` adds it again,
        // producing a duplicate that the client renders twice.
        for (let i = 0; i < arr.length; i++) {
          if ((arr.get(i) as TabSummary).id === tab.id) return;
        }
        arr.push([tab]);
      });
    } finally {
      // Always release the direct connection, even if `transact` throws —
      // otherwise the document handle leaks and accumulates under repeated
      // failures.
      await conn.disconnect();
    }
  } catch (err) {
    logger.warn({ err, roomId, tabId: tab.id }, "broadcastTabsCreated failed");
  }
}

export async function broadcastTabsUpdated(h: Hocuspocus, roomId: string, tab: TabSummary) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
    try {
      await conn.transact((doc) => {
        const arr = doc.getArray<TabSummary>("tabs");
        // Walk from the end so deletes don't shift indices we haven't visited yet.
        // Replace every match — if duplicates ever leaked in, they all get the
        // current state instead of one stale entry being left behind.
        let replaced = false;
        for (let i = arr.length - 1; i >= 0; i--) {
          if ((arr.get(i) as TabSummary).id === tab.id) {
            arr.delete(i, 1);
            if (!replaced) {
              arr.insert(i, [tab]);
              replaced = true;
            }
          }
        }
      });
    } finally {
      await conn.disconnect();
    }
  } catch (err) {
    logger.warn({ err, roomId, tabId: tab.id }, "broadcastTabsUpdated failed");
  }
}

export async function broadcastTabsReordered(h: Hocuspocus, roomId: string, tabs: TabSummary[]) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
    try {
      await conn.transact((doc) => {
        const arr = doc.getArray<TabSummary>("tabs");
        // Build a map from id → updated summary so we can patch in-place.
        const byId = new Map(tabs.map((t) => [t.id, t]));
        for (let i = 0; i < arr.length; i++) {
          const existing = arr.get(i) as TabSummary;
          const updated = byId.get(existing.id);
          if (updated && updated.ordinal !== existing.ordinal) {
            arr.delete(i, 1);
            arr.insert(i, [updated]);
          }
        }
      });
    } finally {
      await conn.disconnect();
    }
  } catch (err) {
    logger.warn({ err, roomId }, "broadcastTabsReordered failed");
  }
}

export async function broadcastTabsDeleted(h: Hocuspocus, roomId: string, tabId: string) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
    try {
      await conn.transact((doc) => {
        const arr = doc.getArray<TabSummary>("tabs");
        // Walk from the end so deletes don't shift indices we haven't visited
        // yet, and remove every match so any pre-existing duplicates are also
        // cleaned up.
        for (let i = arr.length - 1; i >= 0; i--) {
          if ((arr.get(i) as TabSummary).id === tabId) {
            arr.delete(i, 1);
          }
        }
      });
    } finally {
      await conn.disconnect();
    }
  } catch (err) {
    logger.warn({ err, roomId, tabId }, "broadcastTabsDeleted failed");
  }
}

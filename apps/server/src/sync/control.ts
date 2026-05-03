import { logger } from "@/lib/logger";
import type { Hocuspocus } from "@hocuspocus/server";
import type { TabSummary } from "@rumi/protocol";

export async function broadcastTabsCreated(h: Hocuspocus, roomId: string, tab: TabSummary) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
    await conn.transact((doc) => {
      doc.getArray<TabSummary>("tabs").push([tab]);
    });
    await conn.disconnect();
  } catch (err) {
    logger.warn({ err, roomId, tabId: tab.id }, "broadcastTabsCreated failed");
  }
}

export async function broadcastTabsUpdated(h: Hocuspocus, roomId: string, tab: TabSummary) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
    await conn.transact((doc) => {
      const arr = doc.getArray<TabSummary>("tabs");
      for (let i = 0; i < arr.length; i++) {
        if ((arr.get(i) as TabSummary).id === tab.id) {
          arr.delete(i, 1);
          arr.insert(i, [tab]);
          break;
        }
      }
    });
    await conn.disconnect();
  } catch (err) {
    logger.warn({ err, roomId, tabId: tab.id }, "broadcastTabsUpdated failed");
  }
}

export async function broadcastTabsReordered(h: Hocuspocus, roomId: string, tabs: TabSummary[]) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
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
    await conn.disconnect();
  } catch (err) {
    logger.warn({ err, roomId }, "broadcastTabsReordered failed");
  }
}

export async function broadcastTabsDeleted(h: Hocuspocus, roomId: string, tabId: string) {
  try {
    const conn = await h.openDirectConnection(`room:${roomId}`);
    await conn.transact((doc) => {
      const arr = doc.getArray<TabSummary>("tabs");
      for (let i = 0; i < arr.length; i++) {
        if ((arr.get(i) as TabSummary).id === tabId) {
          arr.delete(i, 1);
          break;
        }
      }
    });
    await conn.disconnect();
  } catch (err) {
    logger.warn({ err, roomId, tabId }, "broadcastTabsDeleted failed");
  }
}

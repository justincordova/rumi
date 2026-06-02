import type { TabSummary } from "@rumi/protocol";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";

export function useTabs(opts: {
  initialTabs: TabSummary[];
  controlDoc: Y.Doc | null;
  initialTabId?: string;
}) {
  const [tabs, setTabs] = useState<TabSummary[]>(opts.initialTabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(
    opts.initialTabId ?? opts.initialTabs[0]?.id ?? null,
  );

  // Keep a stable ref to the latest loader-provided tabs so the control-doc
  // effect can read them without re-subscribing on every render.
  const initialTabsRef = useRef(opts.initialTabs);
  initialTabsRef.current = opts.initialTabs;

  useEffect(() => {
    if (!opts.controlDoc) return;
    // The component is reused across room navigations (the route is not keyed
    // on room id), so `initialTabs` is only the *first* room's lazy initial
    // state. When the control doc swaps to a new room, reset to that room's
    // loader tabs first — otherwise an as-yet-empty new control doc leaves the
    // previous room's tabs on screen until its first non-empty broadcast.
    setTabs(initialTabsRef.current);
    const arr = opts.controlDoc.getArray<TabSummary>("tabs");
    const sync = () => {
      const next = arr.toArray();
      // Only adopt the control doc's view if non-empty (defensive: server
      // pushes happen after creation; if the control doc starts empty,
      // the REST initial load is authoritative).
      if (next.length === 0) return;
      // Defensive dedup by id. The server is the only writer and the broadcast
      // helpers in `apps/server/src/sync/control.ts` are now idempotent, but
      // any room that was loaded into memory before that fix shipped may still
      // hold duplicates in its Y.Array. Keep the lowest-ordinal entry per id.
      const byId = new Map<string, TabSummary>();
      for (const t of next) {
        const existing = byId.get(t.id);
        if (!existing || t.ordinal < existing.ordinal) byId.set(t.id, t);
      }
      const deduped = [...byId.values()].sort((a, b) => a.ordinal - b.ordinal);
      setTabs(deduped);
    };
    arr.observe(sync);
    sync();
    return () => arr.unobserve(sync);
  }, [opts.controlDoc]);

  return { tabs, activeTabId, setActiveTabId };
}

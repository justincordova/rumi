import type { TabSummary } from "@rumi/protocol";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!opts.controlDoc) return;
    const arr = opts.controlDoc.getArray<TabSummary>("tabs");
    const sync = () => {
      const next = arr.toArray();
      // Only adopt the control doc's view if non-empty (defensive: server
      // pushes happen after creation; if the control doc starts empty,
      // the REST initial load is authoritative).
      if (next.length > 0) {
        setTabs([...next].sort((a, b) => a.ordinal - b.ordinal));
      }
    };
    arr.observe(sync);
    sync();
    return () => arr.unobserve(sync);
  }, [opts.controlDoc]);

  return { tabs, activeTabId, setActiveTabId };
}

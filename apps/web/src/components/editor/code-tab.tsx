import { exportTextTab } from "@/lib/export-tab";
import { LANGUAGES } from "@/lib/markdown/languages";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { TabSummary } from "@rumi/protocol";
import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { ExportMenu } from "./export-menu";
import { LanguagePicker } from "./language-picker";
import { TabCm } from "./tab-cm";

interface Props {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  tab: TabSummary;
  readOnly: boolean;
  roomSlug: string;
  canManageTabs?: boolean;
}

function countLines(s: string): number {
  // Empty document still has one logical "line" so the UI reads "1 line".
  return s.length === 0 ? 1 : s.split("\n").length;
}

export function CodeTab({ ydoc, provider, tab, readOnly, roomSlug, canManageTabs }: Props) {
  const ytext = ydoc.getText("content");
  // Subscribe to Y.Text changes so the line count updates as the user types
  // (or peers edit). Previously the value was computed once per render and
  // never updated.
  const [lineCount, setLineCount] = useState(() => countLines(ytext.toString()));
  useEffect(() => {
    const handler = () => setLineCount(countLines(ytext.toString()));
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);
  const langName = tab.language ? (LANGUAGES[tab.language]?.name ?? "Plain text") : "Plain text";
  const ext = tab.language ? (LANGUAGES[tab.language]?.fileExtension ?? "txt") : "txt";

  return (
    <div className="flex h-full flex-col">
      <div className="h-10 bg-surface/60 border-b border-border px-3 flex items-center gap-3 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground truncate">{tab.name}</span>
        <LanguagePicker
          roomSlug={roomSlug}
          tabId={tab.id}
          value={tab.language}
          canManage={canManageTabs}
        />
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {lineCount} line{lineCount === 1 ? "" : "s"} · {langName}
        </span>
        <ExportMenu
          options={[
            {
              label: `Download as .${ext}`,
              onSelect: () => exportTextTab(tab, ytext.toString()),
            },
          ]}
        />
      </div>
      <div className="flex-1 min-h-0">
        <TabCm ydoc={ydoc} provider={provider} language={tab.language} readOnly={readOnly} />
      </div>
    </div>
  );
}

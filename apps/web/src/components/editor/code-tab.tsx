import { LANGUAGES } from "@/lib/markdown/languages";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { TabSummary } from "@rumi/protocol";
import type * as Y from "yjs";
import { LanguagePicker } from "./language-picker";
import { TabCm } from "./tab-cm";

interface Props {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  tab: TabSummary;
  readOnly: boolean;
  roomSlug: string;
}

export function CodeTab({ ydoc, provider, tab, readOnly, roomSlug }: Props) {
  const ytext = ydoc.getText("content");
  // Observe line count reactively via a simple state-derived calculation
  const lineCount = ytext.toString().split("\n").length;
  const langName = tab.language ? (LANGUAGES[tab.language]?.name ?? "Plain text") : "Plain text";

  return (
    <div className="flex h-full flex-col">
      <div className="h-10 bg-surface/60 border-b border-border px-3 flex items-center gap-3 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground truncate">{tab.name}</span>
        <LanguagePicker roomSlug={roomSlug} tabId={tab.id} value={tab.language} />
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {lineCount} line{lineCount === 1 ? "" : "s"} · {langName}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <TabCm ydoc={ydoc} provider={provider} language={tab.language} readOnly={readOnly} />
      </div>
    </div>
  );
}

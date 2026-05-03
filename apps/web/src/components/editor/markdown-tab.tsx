import { WELCOME_MARKDOWN } from "@/lib/welcome-content";
import type { EditorView } from "@codemirror/view";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { TabSummary } from "@rumi/protocol";
import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import { MarkdownPreview } from "./markdown-preview";
import { MarkdownToolbar } from "./markdown-toolbar";
import { TabCm } from "./tab-cm";
import { useViewMode } from "./view-mode-toggle";

interface Props {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  tab: TabSummary;
  readOnly: boolean;
  roomSlug: string;
}

export function MarkdownTab({ ydoc, provider, tab, readOnly, roomSlug }: Props) {
  const ytext = ydoc.getText("content");
  const mode = useViewMode(tab.id); // "split" | "rendered" | "source"
  const viewRef = useRef<EditorView | null>(null);

  // Welcome content seed — runs once after the provider syncs.
  // Idempotent: a non-empty Y.Text means another client already seeded.
  useEffect(() => {
    if (readOnly) return;
    if (tab.name !== "Welcome" || tab.language !== "markdown") return;
    const seedIfEmpty = () => {
      if (ytext.length === 0) ytext.insert(0, WELCOME_MARKDOWN);
    };
    if (provider.synced) {
      seedIfEmpty();
    } else {
      provider.on("synced", seedIfEmpty);
      return () => {
        provider.off("synced", seedIfEmpty);
      };
    }
  }, [provider, ytext, tab.name, tab.language, readOnly]);

  return (
    <div className="flex h-full flex-col">
      <MarkdownToolbar
        tab={tab}
        readOnly={readOnly}
        viewRef={viewRef}
        roomSlug={roomSlug}
        ytext={ytext}
      />
      <div
        className={
          mode === "split"
            ? "grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2"
            : "flex flex-1 min-h-0"
        }
      >
        {/* Source pane: always mounted (preserves CodeMirror state across mode flips); hidden when mode === 'rendered' */}
        <div
          className={`min-h-0 ${mode === "rendered" ? "hidden" : "flex-1 md:border-r md:border-border"}`}
        >
          <TabCm ydoc={ydoc} provider={provider} language="markdown" readOnly={readOnly} />
        </div>
        {/* Preview pane: hidden when mode === 'source' */}
        <div className={`min-h-0 overflow-auto ${mode === "source" ? "hidden" : "flex-1"}`}>
          <MarkdownPreview ytext={ytext} />
        </div>
      </div>
    </div>
  );
}

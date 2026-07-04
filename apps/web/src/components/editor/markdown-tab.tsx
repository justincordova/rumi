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
  canManageTabs?: boolean;
}

export function MarkdownTab({ ydoc, provider, tab, readOnly, roomSlug, canManageTabs }: Props) {
  const ytext = ydoc.getText("content");
  const mode = useViewMode(tab.id); // "split" | "rendered" | "source"
  const viewRef = useRef<EditorView | null>(null);

  // Welcome content seed — runs at most ONCE per mount. Hocuspocus emits
  // `synced` on every reconnect, so without this guard a user who deletes
  // the Welcome content and then loses + regains network would see the
  // seed re-inserted on reconnect. The seededRef is intentionally not
  // reset across renders; the only way to re-seed is to remount.
  const seededRef = useRef(false);
  useEffect(() => {
    if (readOnly) return;
    if (tab.name !== "Welcome" || tab.language !== "markdown") return;
    if (seededRef.current) return;
    const seedIfEmpty = () => {
      if (seededRef.current) return;
      seededRef.current = true;
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
        canManageTabs={canManageTabs}
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
          <TabCm
            ydoc={ydoc}
            provider={provider}
            language="markdown"
            readOnly={readOnly}
            externalViewRef={viewRef}
          />
        </div>
        {/* Preview pane: hidden when mode === 'source' */}
        <div className={`min-h-0 overflow-auto ${mode === "source" ? "hidden" : "flex-1"}`}>
          <MarkdownPreview ytext={ytext} />
        </div>
      </div>
    </div>
  );
}

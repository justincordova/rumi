import { Button } from "@/components/ui/button";
import { exportTextTab } from "@/lib/export-tab";
import type { EditorView } from "@codemirror/view";
import type { TabSummary } from "@rumi/protocol";
import { Bold, Code, Heading1, Heading2, Italic, Link, List, Quote } from "lucide-react";
import type React from "react";
import type * as Y from "yjs";
import { ExportMenu } from "./export-menu";
import { prefixLine, wrapSelection } from "./extensions";
import { LanguagePicker } from "./language-picker";
import { ViewModeToggle } from "./view-mode-toggle";

interface Props {
  tab: TabSummary;
  readOnly: boolean;
  viewRef?: React.RefObject<EditorView | null>;
  roomSlug: string;
  ytext: Y.Text;
}

export function MarkdownToolbar({ tab, readOnly, viewRef, roomSlug, ytext }: Props) {
  function dispatch(fn: (view: EditorView) => boolean) {
    if (viewRef?.current) fn(viewRef.current);
  }

  const buttons = [
    { Icon: Heading1, title: "Heading 1", action: (v: EditorView) => prefixLine(v, "# ") },
    { Icon: Heading2, title: "Heading 2", action: (v: EditorView) => prefixLine(v, "## ") },
    { Icon: Bold, title: "Bold (Cmd+B)", action: (v: EditorView) => wrapSelection(v, "**") },
    { Icon: Italic, title: "Italic (Cmd+I)", action: (v: EditorView) => wrapSelection(v, "*") },
    {
      Icon: Link,
      title: "Link (Cmd+K)",
      action: (v: EditorView) => wrapSelection(v, "[", "](url)"),
    },
    { Icon: List, title: "List", action: (v: EditorView) => prefixLine(v, "- ") },
    { Icon: Quote, title: "Blockquote", action: (v: EditorView) => prefixLine(v, "> ") },
    { Icon: Code, title: "Inline code", action: (v: EditorView) => wrapSelection(v, "`") },
  ];

  return (
    <div className="h-10 border-b border-border bg-surface/60 px-2 flex items-center gap-1 shrink-0">
      <div className="flex items-center gap-0.5">
        {buttons.map(({ Icon, title, action }) => (
          <Button
            key={title}
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md"
            title={title}
            disabled={readOnly}
            onClick={() => dispatch(action)}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <LanguagePicker roomSlug={roomSlug} tabId={tab.id} value={tab.language} />
        <ViewModeToggle tabId={tab.id} />
        <ExportMenu
          options={[
            {
              label: "Download as .md",
              onSelect: () => exportTextTab(tab, ytext.toString()),
            },
          ]}
        />
      </div>
    </div>
  );
}

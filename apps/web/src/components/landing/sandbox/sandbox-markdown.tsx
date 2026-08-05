import { Button } from "@/components/ui/button";
import { renderMarkdown } from "@/lib/markdown/render";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { MARKDOWN_SEED } from "./seed";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13.5px",
    fontFamily: "var(--editor-font)",
    background: "var(--color-surface)",
    color: "var(--color-foreground)",
  },
  ".cm-content": { padding: "12px 16px", caretColor: "var(--color-primary)" },
  ".cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--color-primary)" },
  ".cm-selectionBackground": { background: "var(--color-primary-soft)" },
  "&.cm-focused .cm-selectionBackground": { background: "var(--color-primary-soft)" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { background: "var(--color-muted)" },
  ".cm-placeholder": { color: "var(--color-muted-foreground)", fontStyle: "italic" },
});

export default function SandboxMarkdown() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const ydocRef = useRef(new Y.Doc());
  const ytextRef = useRef(ydocRef.current.getText("content"));
  const [previewHtml, setPreviewHtml] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const ytext = ytextRef.current;
    if (ytext.length === 0) {
      ytext.insert(0, MARKDOWN_SEED);
    }

    let disposed = false;
    // renderMarkdown lazily fetches Shiki grammar chunks, so two renders can
    // take very different amounts of time and resolve out of order — the
    // slower earlier one would then overwrite the newer HTML and leave the
    // preview showing text the editor no longer contains. Stamp each run and
    // only accept the latest.
    let seq = 0;
    const render = async () => {
      const mine = ++seq;
      try {
        const html = await renderMarkdown(ytext.toString());
        if (disposed || mine !== seq) return;
        setPreviewHtml(html);
      } catch {
        // A failed Shiki chunk fetch (offline, stale chunk after a deploy)
        // must not surface as an unhandled rejection and must not leave the
        // visitor staring at a blank pane next to a working editor.
        if (disposed || mine !== seq) return;
        setPreviewHtml(
          '<p class="text-muted-foreground italic">Preview failed to render. Try refreshing.</p>',
        );
      }
    };
    void render();

    const observer = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void render(), 400);
    };
    ytext.observe(observer);

    return () => {
      disposed = true;
      ytext.unobserve(observer);
      clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    const ytext = ytextRef.current;
    const undoManager = new Y.UndoManager(ytext);

    const view = new EditorView({
      parent: editorRef.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          dropCursor(),
          drawSelection(),
          placeholder("Start writing…"),
          markdown({ base: markdownLanguage }),
          editorTheme,
          yCollab(ytext, null, { undoManager }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const reset = () => {
    const ytext = ytextRef.current;
    ytext.delete(0, ytext.length);
    ytext.insert(0, MARKDOWN_SEED);
  };

  return (
    <div className="flex flex-col h-[550px] rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Markdown</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={reset}>
          <RotateCcw className="h-3 w-3 mr-1" />
          Reset
        </Button>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-border">
        <div ref={editorRef} className="h-full overflow-auto" />
        <div
          className="h-full overflow-auto px-4 py-3 prose prose-sm dark:prose-invert max-w-none"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered markdown passes through rehype-sanitize
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    </div>
  );
}

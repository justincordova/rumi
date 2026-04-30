import { EditorSelection } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { EditorView } from "@codemirror/view";

export function wrapSelection(view: EditorView, prefix: string, suffix: string = prefix): boolean {
  const { state, dispatch } = view;
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const replacement = `${prefix}${selected}${suffix}`;
    return {
      changes: { from: range.from, to: range.to, insert: replacement },
      range: EditorSelection.range(
        range.from + prefix.length,
        range.from + prefix.length + selected.length,
      ),
    };
  });
  dispatch(state.update(changes));
  return true;
}

export function prefixLine(view: EditorView, prefix: string): boolean {
  const { state, dispatch } = view;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    return {
      changes: { from: line.from, insert: prefix },
      range: EditorSelection.range(range.anchor + prefix.length, range.head + prefix.length),
    };
  });
  dispatch(state.update(changes));
  return true;
}

export const markdownShortcutKeymap: KeyBinding[] = [
  {
    key: "Mod-b",
    run: (view) => wrapSelection(view, "**"),
  },
  {
    key: "Mod-i",
    run: (view) => wrapSelection(view, "*"),
  },
  {
    key: "Mod-k",
    run: (view) => {
      const { state, dispatch } = view;
      const changes = state.changeByRange((range) => {
        const selected = state.sliceDoc(range.from, range.to);
        const replacement = `[${selected}](url)`;
        return {
          changes: { from: range.from, to: range.to, insert: replacement },
          range: EditorSelection.range(
            range.from + selected.length + 3,
            range.from + selected.length + 6,
          ),
        };
      });
      dispatch(state.update(changes));
      return true;
    },
  },
];

// A minimal CodeMirror theme that uses our CSS vars.
export const rumiEditorTheme = EditorView.theme({
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
  // Yjs cursor colors
  ".cm-ySelectionInfo": {
    padding: "1px 4px",
    borderRadius: "3px",
    fontSize: "11px",
    fontFamily: "var(--font-sans)",
  },
});

import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Rumi source-pane typography: sized headings, monospace inline code,
// muted markers, italic emphasis, primary-colored links.
export const rumiHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "bold", fontSize: "1.35em" },
  { tag: t.heading2, fontWeight: "bold", fontSize: "1.2em" },
  { tag: t.heading3, fontWeight: "bold", fontSize: "1.1em" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.monospace, fontFamily: "var(--editor-font)" },
  { tag: t.link, color: "var(--color-primary)" },
  { tag: t.url, color: "var(--color-primary)" },
  { tag: t.comment, color: "var(--color-muted-foreground)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--color-primary)" },
  { tag: t.string, color: "var(--color-success)" },
  { tag: t.number, color: "var(--color-warning)" },
  { tag: t.operator, color: "var(--color-foreground)" },
  { tag: t.variableName, color: "var(--color-foreground)" },
  { tag: t.typeName, color: "var(--color-accent-foreground)" },
  { tag: t.className, color: "var(--color-accent-foreground)" },
]);

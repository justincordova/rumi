import { LANGUAGES } from "@/lib/markdown/languages";
import type { TabSummary } from "@rumi/protocol";
import type { Editor } from "tldraw";

/**
 * Sanitize a tab name for use as a filename. Strips disallowed characters,
 * collapses whitespace, and falls back to "untitled" when the result is empty.
 */
function safeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || "untitled";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Allow the browser to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export a markdown or code tab as a text file with the appropriate extension. */
export function exportTextTab(tab: TabSummary, content: string): void {
  const lang = tab.language ? LANGUAGES[tab.language] : null;
  const ext = lang?.fileExtension ?? "txt";
  const mime = ext === "md" ? "text/markdown" : "text/plain";
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  triggerDownload(blob, `${safeFilename(tab.name)}.${ext}`);
}

/**
 * Export the current contents of a drawing tab as a PNG or SVG.
 * Uses tldraw's `editor.toImage()` API.
 */
export async function exportDrawingTab(
  editor: Editor,
  tab: TabSummary,
  format: "png" | "svg",
): Promise<void> {
  const shapeIds = Array.from(editor.getCurrentPageShapeIds());
  if (shapeIds.length === 0) {
    throw new Error("Nothing to export — the canvas is empty.");
  }
  const result = await editor.toImage(shapeIds, {
    format,
    background: false,
    padding: 32,
  });
  triggerDownload(result.blob, `${safeFilename(tab.name)}.${format}`);
}

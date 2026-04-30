import { type Highlighter, createHighlighter } from "shiki";

let instance: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

export async function getHighlighter() {
  if (!instance) {
    instance = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: ["markdown"], // others loaded on demand
    });
  }
  return instance;
}

export async function ensureLanguage(lang: string) {
  const h = await getHighlighter();
  if (loadedLangs.has(lang)) return h;
  try {
    // biome-ignore lint/suspicious/noExplicitAny: Shiki's loadLanguage accepts any valid language id
    await h.loadLanguage(lang as any);
    loadedLangs.add(lang);
  } catch {
    // Unknown language — silently fall through; Shiki renders as plain text.
  }
  return h;
}

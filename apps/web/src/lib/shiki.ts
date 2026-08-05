import { type Highlighter, createHighlighter } from "shiki";

let instance: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

export async function getHighlighter() {
  if (!instance) {
    instance = createHighlighter({
      // The plain github-light/github-dark themes fail WCAG AA inside the
      // markdown preview: their worst tokens measure 3.49:1 (a parameter name
      // on white) and 3.05:1 (a comment). The high-contrast variants of the
      // same family reach 8.06:1 and 9.23:1.
      themes: ["github-light-high-contrast", "github-dark-high-contrast"],
      langs: ["markdown"], // others loaded on demand
    }).catch((err) => {
      // Reset on init failure so the next call retries. Without this, a
      // transient CDN/WASM init error poisoned the module-level cache
      // forever and every future getHighlighter call rejected.
      instance = null;
      throw err;
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

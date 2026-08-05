import { ensureLanguage, getHighlighter } from "@/lib/shiki";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import rehypeSanitize, { type Options as Schema, defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

// High-contrast variants: the plain github themes' dimmest tokens measure
// 3.49:1 (light) and 3.05:1 (dark), below the 4.5:1 AA floor for body text.
// These names also feed SHIKI_TOKEN below, which allow-lists the classes Shiki
// emits — they must stay in sync with lib/shiki.ts or the sanitizer strips
// every highlight and code renders monochrome.
const THEME_LIGHT = "github-light-high-contrast";
const THEME_DARK = "github-dark-high-contrast";

// `@shikijs/rehype` writes RAW HTML attribute names onto the hast nodes —
// `class`, `style`, `tabindex` — not the hast property names `className` /
// `tabIndex`. The schema below therefore has to allow-list those exact keys.
// The previous `"className"` entries matched nothing, so rehype-sanitize
// stripped every class and style Shiki produced and code blocks rendered as
// unhighlighted monochrome text for every user.
//
// Raw HTML never reaches the sanitizer (remarkRehype runs without
// `allowDangerousHtml`, so `<span style=…>` in the source is dropped at the
// mdast→hast step), which means the only `class`/`style` values present here
// are Shiki's own. The allow-lists below are still pinned to Shiki's exact
// output as defense in depth, so nothing else — `position: fixed` UI redress,
// `background: url(http://evil)` tracking pixels — can ride along.
const SHIKI_TOKEN = `(?:shiki|shiki-themes|line|${THEME_LIGHT}|${THEME_DARK})`;
const SHIKI_CLASS = new RegExp(`^${SHIKI_TOKEN}(?: ${SHIKI_TOKEN})*$`);
// With `defaultColor: false` Shiki encodes its palette as `--shiki-*` custom
// properties; CSS in globals.css maps them onto color/background per theme.
const SHIKI_STYLE = /^(?:\s*--shiki-[a-z-]+\s*:\s*#[0-9a-f]{3,8}\s*;?)+$/i;

/** `[attribute, ...allowedValues]` — the tuple form rehype-sanitize expects. */
type PropertyDefinition = NonNullable<Schema["attributes"]>[string][number];

const allow = (name: string, ...values: Array<string | RegExp>): PropertyDefinition =>
  [name, ...values] as PropertyDefinition;

// Sanitize schema: GFM defaults + Shiki's highlighting output.
const schema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // `code` needs nothing extra: Shiki puts no attributes there, and the
    // default schema already permits `language-*` for the un-highlighted
    // fallback.
    pre: [
      ...(defaultSchema.attributes?.pre ?? []),
      allow("class", SHIKI_CLASS),
      allow("style", SHIKI_STYLE),
      allow("tabindex", "0"),
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      allow("class", SHIKI_CLASS),
      allow("style", SHIKI_STYLE),
    ],
  },
};

// biome-ignore lint/suspicious/noExplicitAny: unified processor generic types are deeply complex
let processor: Promise<any> | null = null;

function buildProcessor() {
  // If the highlighter fails (CDN failure, transient init error), reset the
  // module cache so the next renderMarkdown() call retries — otherwise a
  // single startup failure permanently breaks all preview rendering.
  return getHighlighter()
    .then((highlighter) =>
      unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype)
        .use(rehypeShikiFromHighlighter, highlighter, {
          themes: { light: THEME_LIGHT, dark: THEME_DARK },
          defaultColor: false, // we drive theme via CSS vars
        })
        .use(rehypeSanitize, schema)
        .use(rehypeStringify),
    )
    .catch((err) => {
      processor = null;
      throw err;
    });
}

// Info string of a fenced code block: ```ts, ~~~python, ```  js  …
const FENCE_LANG_RE = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]+)/gm;

/**
 * Load the Shiki grammars this document actually needs.
 *
 * `getHighlighter()` boots with only `markdown` loaded and grammars are
 * registered lazily. Nothing used to call `ensureLanguage`, so every fenced
 * block in any other language hit Shiki's unknown-language fallback and
 * rendered as plain text — including the ```ts block in the seeded Welcome
 * content that every new room starts with.
 *
 * `ensureLanguage` swallows unknown ids (Shiki then renders plain text, which
 * is the right outcome for a typo'd info string) and caches what it loads, so
 * this is cheap on repeat renders.
 */
async function ensureFencedLanguages(source: string): Promise<void> {
  const wanted = new Set<string>();
  for (const match of source.matchAll(FENCE_LANG_RE)) {
    const lang = match[1]?.toLowerCase();
    if (lang) wanted.add(lang);
  }
  if (wanted.size === 0) return;
  await Promise.all([...wanted].map((lang) => ensureLanguage(lang)));
}

export async function renderMarkdown(source: string): Promise<string> {
  processor ??= buildProcessor();
  try {
    // biome-ignore lint/suspicious/noExplicitAny: processor type is complex unified pipeline
    const p: any = await processor;
    // Must run before process(): the grammar has to be registered on the
    // shared highlighter by the time the rehype transform walks the tree.
    await ensureFencedLanguages(source);
    const file = await p.process(source);
    return String(file);
  } catch (err) {
    // Without this null, a one-time init failure (rejected `processor`
    // promise) would poison every future call — `??=` only assigns when
    // null/undefined, so the rejected promise sat there forever and every
    // subsequent renderMarkdown call rejected with the same error.
    processor = null;
    throw err;
  }
}

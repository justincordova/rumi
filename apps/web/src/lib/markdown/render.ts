import { getHighlighter } from "@/lib/shiki";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

// Sanitize schema: GFM defaults + allow class on code/pre.
//
// We deliberately do NOT allow `style` on any element. Shiki is configured
// with `defaultColor: false` below, which emits classes instead of inline
// `style="color:..."` — so allowing `style` here was an unused attack surface
// that let attacker-controlled markdown smuggle CSS (e.g. `position:fixed`
// for UI redress, or `background:url(http://evil)` for tracking pixels).
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
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
          themes: { light: "github-light", dark: "github-dark" },
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

export async function renderMarkdown(source: string): Promise<string> {
  processor ??= buildProcessor();
  // biome-ignore lint/suspicious/noExplicitAny: processor type is complex unified pipeline
  const p: any = await processor;
  const file = await p.process(source);
  return String(file);
}

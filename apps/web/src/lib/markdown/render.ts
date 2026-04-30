import { getHighlighter } from "@/lib/shiki";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

// Sanitize schema: GFM defaults + allow class on code/pre + data-* attributes
// (Shiki writes these for theme switching).
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className", "style"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "style"],
  },
};

// biome-ignore lint/suspicious/noExplicitAny: unified processor generic types are deeply complex
let processor: Promise<any> | null = null;

function buildProcessor() {
  return getHighlighter().then((highlighter) =>
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
  );
}

export async function renderMarkdown(source: string): Promise<string> {
  processor ??= buildProcessor();
  // biome-ignore lint/suspicious/noExplicitAny: processor type is complex unified pipeline
  const p: any = await processor;
  const file = await p.process(source);
  return String(file);
}

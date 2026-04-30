import { renderMarkdown } from "@/lib/markdown/render";
import { useDeferredValue, useEffect, useState } from "react";
import type * as Y from "yjs";

interface Props {
  ytext: Y.Text;
}

export function MarkdownPreview({ ytext }: Props) {
  const [source, setSource] = useState(() => ytext.toString());
  const [html, setHtml] = useState("");
  const deferredSource = useDeferredValue(source);

  // Observe Y.Text changes.
  useEffect(() => {
    const handler = () => setSource(ytext.toString());
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Render markdown (debounced via useDeferredValue).
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      const result = await renderMarkdown(deferredSource);
      if (!cancelled) setHtml(result);
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [deferredSource]);

  return (
    <div
      className="h-full overflow-auto p-4 prose prose-sm max-w-none dark:prose-invert scrollbar-thin"
      // Content is sanitized by rehype-sanitize before being set here.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized server-side via rehype-sanitize
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

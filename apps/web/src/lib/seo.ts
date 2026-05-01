import { useEffect } from "react";

const TITLE = "Rumi — Real-time collaboration for developers";
const DESCRIPTION = "Markdown, code, and drawings in shared rooms. No setup, no merge conflicts.";
const URL = "https://rumi.app/";
const OG_IMAGE = "/og-cover.png";

type MetaDef = {
  attr: "name" | "property" | "rel";
  key: string;
  content: string;
};

const METAS: MetaDef[] = [
  { attr: "name", key: "description", content: DESCRIPTION },
  { attr: "property", key: "og:title", content: TITLE },
  { attr: "property", key: "og:description", content: DESCRIPTION },
  { attr: "property", key: "og:type", content: "website" },
  { attr: "property", key: "og:url", content: URL },
  { attr: "property", key: "og:image", content: OG_IMAGE },
  { attr: "name", key: "twitter:card", content: "summary_large_image" },
  { attr: "name", key: "twitter:title", content: TITLE },
  { attr: "name", key: "twitter:description", content: DESCRIPTION },
  { attr: "name", key: "twitter:image", content: OG_IMAGE },
];

export function useSeoMeta() {
  useEffect(() => {
    document.title = TITLE;

    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = URL;
    document.head.appendChild(canonical);

    const els: HTMLElement[] = [canonical];

    for (const m of METAS) {
      const el = document.createElement("meta");
      el.setAttribute(m.attr, m.key);
      el.content = m.content;
      document.head.appendChild(el);
      els.push(el);
    }

    return () => {
      for (const el of els) el.remove();
    };
  }, []);
}

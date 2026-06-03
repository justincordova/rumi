import { useEffect } from "react";

const DEFAULT_TITLE = "Rumi — Real-time collaboration for developers";
const DEFAULT_DESCRIPTION =
  "Markdown, code, and drawings in shared rooms. No setup, no merge conflicts.";
const SITE_ORIGIN = "https://rumi.app";
const DEFAULT_OG_IMAGE = "/og-cover.png";

type MetaDef = {
  attr: "name" | "property";
  key: string;
  content: string;
};

export interface SeoOptions {
  title?: string;
  description?: string;
  /** Path or absolute URL. Defaults to "/" (the landing page). */
  canonical?: string;
  ogImage?: string;
  /** When true, adds `<meta name="robots" content="noindex">`. */
  noindex?: boolean;
}

function resolveCanonical(canonical: string | undefined): string {
  if (!canonical) return `${SITE_ORIGIN}/`;
  if (canonical.startsWith("http://") || canonical.startsWith("https://")) return canonical;
  return `${SITE_ORIGIN}${canonical.startsWith("/") ? canonical : `/${canonical}`}`;
}

export function useSeoMeta(opts: SeoOptions = {}) {
  const {
    title = DEFAULT_TITLE,
    description = DEFAULT_DESCRIPTION,
    canonical,
    ogImage = DEFAULT_OG_IMAGE,
    noindex = false,
  } = opts;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const canonicalUrl = resolveCanonical(canonical);
    // og:image / twitter:image MUST be absolute — link-preview crawlers
    // (Slack, Discord, Facebook, iMessage, Twitter) do not resolve relative
    // paths, so a leading-slash default would render no preview image.
    const ogImageUrl = resolveCanonical(ogImage);

    const canonicalEl = document.createElement("link");
    canonicalEl.rel = "canonical";
    canonicalEl.href = canonicalUrl;
    document.head.appendChild(canonicalEl);

    const els: HTMLElement[] = [canonicalEl];

    const metas: MetaDef[] = [
      { attr: "name", key: "description", content: description },
      { attr: "property", key: "og:title", content: title },
      { attr: "property", key: "og:description", content: description },
      { attr: "property", key: "og:type", content: "website" },
      { attr: "property", key: "og:url", content: canonicalUrl },
      { attr: "property", key: "og:image", content: ogImageUrl },
      { attr: "name", key: "twitter:card", content: "summary_large_image" },
      { attr: "name", key: "twitter:title", content: title },
      { attr: "name", key: "twitter:description", content: description },
      { attr: "name", key: "twitter:image", content: ogImageUrl },
    ];
    if (noindex) metas.push({ attr: "name", key: "robots", content: "noindex" });

    for (const m of metas) {
      const el = document.createElement("meta");
      el.setAttribute(m.attr, m.key);
      el.content = m.content;
      document.head.appendChild(el);
      els.push(el);
    }

    return () => {
      for (const el of els) el.remove();
      document.title = previousTitle;
    };
  }, [title, description, canonical, ogImage, noindex]);
}

import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";

type LanguageEntry = {
  name: string;
  // CodeMirror language extension factory; can be sync or async (lazy-loaded).
  cmExtension: () => Extension | Promise<Extension>;
  // Shiki language id (used for the markdown preview's fenced code blocks).
  shiki: string;
};

export const LANGUAGES: Record<string, LanguageEntry> = {
  markdown: {
    name: "Markdown",
    cmExtension: () => markdown(),
    shiki: "markdown",
  },
  typescript: {
    name: "TypeScript",
    cmExtension: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      ),
    shiki: "typescript",
  },
  javascript: {
    name: "JavaScript",
    cmExtension: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
    shiki: "javascript",
  },
  python: {
    name: "Python",
    cmExtension: () => import("@codemirror/lang-python").then((m) => m.python()),
    shiki: "python",
  },
  go: {
    name: "Go",
    cmExtension: () => import("@codemirror/lang-go").then((m) => m.go()),
    shiki: "go",
  },
  rust: {
    name: "Rust",
    cmExtension: () => import("@codemirror/lang-rust").then((m) => m.rust()),
    shiki: "rust",
  },
  json: {
    name: "JSON",
    cmExtension: () => import("@codemirror/lang-json").then((m) => m.json()),
    shiki: "json",
  },
  html: {
    name: "HTML",
    cmExtension: () => import("@codemirror/lang-html").then((m) => m.html()),
    shiki: "html",
  },
  css: {
    name: "CSS",
    cmExtension: () => import("@codemirror/lang-css").then((m) => m.css()),
    shiki: "css",
  },
};

export type LanguageId = keyof typeof LANGUAGES;

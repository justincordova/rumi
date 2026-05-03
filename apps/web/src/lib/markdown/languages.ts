import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";

type LanguageEntry = {
  name: string;
  // CodeMirror language extension factory; can be sync or async (lazy-loaded).
  cmExtension: () => Extension | Promise<Extension>;
  // Shiki language id (used for the markdown preview's fenced code blocks).
  shiki: string;
  // File extension used when exporting a tab to disk (without leading dot).
  fileExtension: string;
};

export const LANGUAGES: Record<string, LanguageEntry> = {
  markdown: {
    name: "Markdown",
    cmExtension: () => markdown(),
    shiki: "markdown",
    fileExtension: "md",
  },
  typescript: {
    name: "TypeScript",
    cmExtension: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      ),
    shiki: "typescript",
    fileExtension: "ts",
  },
  javascript: {
    name: "JavaScript",
    cmExtension: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
    shiki: "javascript",
    fileExtension: "js",
  },
  python: {
    name: "Python",
    cmExtension: () => import("@codemirror/lang-python").then((m) => m.python()),
    shiki: "python",
    fileExtension: "py",
  },
  go: {
    name: "Go",
    cmExtension: () => import("@codemirror/lang-go").then((m) => m.go()),
    shiki: "go",
    fileExtension: "go",
  },
  rust: {
    name: "Rust",
    cmExtension: () => import("@codemirror/lang-rust").then((m) => m.rust()),
    shiki: "rust",
    fileExtension: "rs",
  },
  json: {
    name: "JSON",
    cmExtension: () => import("@codemirror/lang-json").then((m) => m.json()),
    shiki: "json",
    fileExtension: "json",
  },
  html: {
    name: "HTML",
    cmExtension: () => import("@codemirror/lang-html").then((m) => m.html()),
    shiki: "html",
    fileExtension: "html",
  },
  css: {
    name: "CSS",
    cmExtension: () => import("@codemirror/lang-css").then((m) => m.css()),
    shiki: "css",
    fileExtension: "css",
  },
};

export type LanguageId = keyof typeof LANGUAGES;

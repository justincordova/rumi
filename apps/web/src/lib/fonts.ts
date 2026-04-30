export const UI_FONTS = {
  lato: {
    name: "Lato",
    stack: '"Lato", system-ui, sans-serif',
    features: undefined,
  },
  inter: {
    name: "Inter",
    stack: '"Inter Variable", system-ui, sans-serif',
    features: '"cv11", "ss01", "ss03"',
  },
  system: {
    name: "System",
    stack: "system-ui, -apple-system, sans-serif",
    features: undefined,
  },
} as const;

export const EDITOR_FONTS = {
  "geist-mono": {
    name: "Geist Mono",
    stack: '"Geist Mono Variable", ui-monospace, monospace',
    features: undefined,
  },
  "jetbrains-mono": {
    name: "JetBrains Mono",
    stack: '"JetBrains Mono Variable", ui-monospace, monospace',
    features: undefined,
  },
  "fira-code": {
    name: "Fira Code",
    stack: '"Fira Code Variable", ui-monospace, monospace',
    features: '"liga", "calt"',
  },
  "ibm-plex-mono": {
    name: "IBM Plex Mono",
    stack: '"IBM Plex Mono", ui-monospace, monospace',
    features: undefined,
  },
  "system-mono": {
    name: "System Mono",
    stack: "ui-monospace, monospace",
    features: undefined,
  },
} as const;

export type UiFontKey = keyof typeof UI_FONTS;
export type EditorFontKey = keyof typeof EDITOR_FONTS;

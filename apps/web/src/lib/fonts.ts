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

// Only list families that styles/fonts.css actually loads an @font-face for.
// JetBrains Mono, Fira Code and IBM Plex Mono used to be offered here and are
// enumerated straight into the Font picker by appearance-items.tsx — but no
// @font-face is ever declared for them (fonts.css imports only Lato and Geist
// Mono, and there are no such packages in package.json). Selecting one showed
// a checkmark and persisted the preference while the editor silently fell back
// to `ui-monospace`, i.e. exactly the "System Mono" option. Add the fontsource
// package and an import in fonts.css before adding an entry here.
export const EDITOR_FONTS = {
  "geist-mono": {
    name: "Geist Mono",
    stack: '"Geist Mono Variable", ui-monospace, monospace',
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

export const DEFAULT_UI_FONT: UiFontKey = "lato";
export const DEFAULT_EDITOR_FONT: EditorFontKey = "geist-mono";

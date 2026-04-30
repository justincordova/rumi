import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorFontKey, UiFontKey } from "./fonts";

type Theme = "light" | "dark" | "system";

interface PrefsState {
  theme: Theme;
  uiFont: UiFontKey;
  editorFont: EditorFontKey;
  fontSize: number;
  wordWrap: boolean;
  compactMode: boolean;
  setTheme: (t: Theme) => void;
  setUiFont: (f: UiFontKey) => void;
  setEditorFont: (f: EditorFontKey) => void;
  setFontSize: (s: number) => void;
  setWordWrap: (w: boolean) => void;
  setCompactMode: (c: boolean) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "dark",
      uiFont: "lato",
      editorFont: "geist-mono",
      fontSize: 14,
      wordWrap: true,
      compactMode: false,
      setTheme: (theme) => set({ theme }),
      setUiFont: (uiFont) => set({ uiFont }),
      setEditorFont: (editorFont) => set({ editorFont }),
      setFontSize: (fontSize) => set({ fontSize }),
      setWordWrap: (wordWrap) => set({ wordWrap }),
      setCompactMode: (compactMode) => set({ compactMode }),
    }),
    { name: "rumi-prefs" },
  ),
);

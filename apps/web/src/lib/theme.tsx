import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { type ReactNode, useEffect } from "react";
import { EDITOR_FONTS, UI_FONTS } from "./fonts";
import { usePrefs } from "./prefs";

function PrefsBridge({ children }: { children: ReactNode }) {
  const { theme, uiFont, editorFont } = usePrefs();
  const { setTheme } = useTheme();

  // Push prefs.theme into next-themes whenever it changes.
  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);

  // Apply font CSS vars + font-feature-settings to :root.
  useEffect(() => {
    const root = document.documentElement;
    const ui = UI_FONTS[uiFont];
    const editor = EDITOR_FONTS[editorFont];

    root.style.setProperty("--ui-font", ui.stack);
    root.style.setProperty("--editor-font", editor.stack);

    // UI font features apply globally to the body via font-feature-settings.
    if (ui.features) root.style.setProperty("font-feature-settings", ui.features);
    else root.style.removeProperty("font-feature-settings");

    // Editor font features expose a CSS var that editor surfaces opt into.
    if (editor.features) root.style.setProperty("--editor-font-feature-settings", editor.features);
    else root.style.removeProperty("--editor-font-feature-settings");
  }, [uiFont, editorFont]);

  return children;
}

// next-themes' `ThemeProviderProps extends React.PropsWithChildren` but the
// type-resolution chain in this monorepo (mixed @types/react versions in the
// dep tree) loses the children prop. Cast around it.
// biome-ignore lint/suspicious/noExplicitAny: cross-package type drift workaround
const TypedNextThemesProvider = NextThemesProvider as any;

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <TypedNextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <PrefsBridge>{children}</PrefsBridge>
    </TypedNextThemesProvider>
  );
}

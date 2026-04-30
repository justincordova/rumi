import { usePrefs } from "@/lib/prefs";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

type Resolved = "light" | "dark";

export function useTldrawTheme(): { theme: Resolved } {
  const prefsTheme = usePrefs((s) => s.theme);
  const { resolvedTheme } = useTheme();
  const [theme, setTheme] = useState<Resolved>((resolvedTheme as Resolved) ?? "dark");

  useEffect(() => {
    if (prefsTheme === "system") {
      setTheme((resolvedTheme as Resolved) ?? "dark");
    } else {
      setTheme(prefsTheme);
    }
  }, [prefsTheme, resolvedTheme]);

  return { theme };
}

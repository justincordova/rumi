# Design System Plan

> **Goal:** Implement the design-system foundation (Tailwind v4 tokens, dark-mode default, prefs store, fonts, shadcn init, demo route) before any feature work begins.
> **Spec:** [docs/SPEC.md](../SPEC.md)
> **Design:** [docs/designs/design-system.md](../designs/design-system.md)

## Task 1: Install design-system dependencies + test DOM environment

- **What:** Add the new npm dependencies the design system needs, plus `happy-dom` for React component tests (CodeMirror, Radix, and React DOM all require a real DOM during test execution; bun's default test runner has none).
- **Why:** Every subsequent task imports from these. Install once at the top so we don't churn `package.json` repeatedly. The happy-dom registration ships now even though no design-system code consumes it — the very next phase (auth-and-rooms) starts mounting React components in tests.
- **How:**
  - In `apps/web/`, add to `dependencies`:
    - `next-themes@^0.4.0` (theme toggling + anti-flash + system pref)
    - `@fontsource-variable/lato` (UI font default)
    - `geist` (ships Geist + Geist Mono variable fonts)
    - `clsx@^2.1.0` (used by shadcn's `cn()`)
    - `tailwind-merge@^2.5.0` (used by shadcn's `cn()`)
  - In `apps/web/`, add to `devDependencies`:
    - `happy-dom@^15.0.0`
    - `@happy-dom/global-registrator@^15.0.0`
  - Create `apps/web/test-setup.ts`:
    ```ts
    import { GlobalRegistrator } from "@happy-dom/global-registrator";
    GlobalRegistrator.register();
    ```
  - Create `apps/web/bunfig.toml` (or extend an existing one):
    ```toml
    [test]
    preload = ["./test-setup.ts"]
    ```
  - Run `bun install` from repo root.
- **Verify:** `bun install` exits 0; new deps appear in `apps/web/package.json`; `bun run typecheck` from root still passes; `bun --cwd apps/web test` discovers the preload (a smoke test that checks `typeof document === "object"` would confirm).

## Task 2: Port design tokens into `globals.css` via Tailwind v4 `@theme` block

- **What:** Replace the placeholder `@import "tailwindcss"` with the full token system.
- **Why:** Tokens are the foundation everything below references. Tailwind v4 generates utility classes from `@theme` declarations at build time; without them, `bg-primary`, `text-muted-foreground`, etc. don't exist.
- **How:**
  - Open `apps/web/src/styles/globals.css` (currently 1 line).
  - **Strategy:** Tailwind v4's `@theme` block declares the canonical values. Tailwind generates utilities from these (`bg-background`, `text-muted-foreground`, etc.). For dark-mode theming, override the same `--color-*` vars under a `[data-theme="dark"]` selector — Tailwind's runtime CSS reads via these vars, so overrides "just work." Color HSL values come verbatim from `docs/_refs/rumi-collab/src/index.css` (lines 8–114).
  - Replace `globals.css` with:
    ```css
    @import "tailwindcss";

    /* Tailwind v4 design tokens — canonical declarations */
    @theme {
      /* Light theme color defaults */
      --color-background: hsl(40 16% 97%);
      --color-foreground: hsl(230 18% 14%);
      --color-surface: hsl(0 0% 100%);
      --color-surface-elevated: hsl(0 0% 100%);
      --color-primary: hsl(244 62% 56%);
      --color-primary-foreground: hsl(0 0% 100%);
      --color-primary-soft: hsl(244 80% 96%);
      --color-secondary: hsl(40 12% 94%);
      --color-secondary-foreground: hsl(230 18% 14%);
      --color-muted: hsl(40 14% 95%);
      --color-muted-foreground: hsl(230 8% 45%);
      --color-accent: hsl(244 80% 96%);
      --color-accent-foreground: hsl(244 62% 40%);
      --color-destructive: hsl(0 72% 56%);
      --color-destructive-foreground: hsl(0 0% 100%);
      --color-success: hsl(152 58% 44%);
      --color-warning: hsl(36 92% 54%);
      --color-border: hsl(36 12% 90%);
      --color-border-strong: hsl(36 10% 84%);
      --color-ring: hsl(244 62% 56%);
      --color-presence-1: hsl(244 62% 56%);
      --color-presence-2: hsl(162 58% 46%);
      --color-presence-3: hsl(14 80% 60%);
      --color-presence-4: hsl(280 60% 60%);
      --color-presence-5: hsl(36 92% 54%);

      /* Radius */
      --radius: 0.75rem;

      /* Shadows */
      --shadow-xs: 0 1px 2px hsl(230 18% 14% / 0.04);
      --shadow-sm: 0 1px 2px hsl(230 18% 14% / 0.04), 0 1px 3px hsl(230 18% 14% / 0.06);
      --shadow-md: 0 4px 12px -2px hsl(230 18% 14% / 0.08), 0 2px 4px -2px hsl(230 18% 14% / 0.04);
      --shadow-lg: 0 12px 32px -8px hsl(230 18% 14% / 0.12), 0 4px 8px -4px hsl(230 18% 14% / 0.06);
      --shadow-float: 0 8px 24px -6px hsl(244 62% 30% / 0.15), 0 2px 6px -2px hsl(230 18% 14% / 0.06);

      /* Motion */
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

      /* Named animations — exposed as animate-* utilities */
      --animate-fade-in: fade-in 250ms var(--ease-out) both;
      --animate-scale-in: scale-in 180ms var(--ease-spring) both;
      --animate-pulse-soft: pulse-soft 2.4s ease-in-out infinite;

      /* Fonts (refer to runtime CSS vars on :root for user-changeable swaps) */
      --font-sans: var(--ui-font);
      --font-mono: var(--editor-font);

      /* Gradients — exposed as bg-gradient-* utilities via background-image keys */
      --background-image-gradient-subtle: var(--gradient-subtle);
      --background-image-gradient-brand: var(--gradient-brand);
    }

    /* Keyframes for the named animations above */
    @keyframes fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes scale-in {
      from { opacity: 0; transform: scale(0.96); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes pulse-soft {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.5; }
    }

    /* Runtime-mutable CSS vars — the prefs store overrides these on :root via JS */
    :root {
      --ui-font: "Lato Variable", system-ui, sans-serif;
      --editor-font: "Geist Mono Variable", ui-monospace, monospace;
      --gradient-subtle: radial-gradient(circle at 30% 0%, hsl(244 80% 96% / 0.6), transparent 60%);
      --gradient-brand: linear-gradient(135deg, hsl(244 62% 56%), hsl(264 70% 60%));
    }

    /* Dark theme overrides — same --color-* keys, different values */
    [data-theme="dark"] {
      --color-background: hsl(230 20% 9%);
      --color-foreground: hsl(40 16% 96%);
      --color-surface: hsl(230 18% 12%);
      --color-surface-elevated: hsl(230 16% 15%);
      --color-primary: hsl(244 80% 70%);
      --color-primary-foreground: hsl(230 30% 10%);
      --color-primary-soft: hsl(244 40% 20%);
      --color-secondary: hsl(230 14% 17%);
      --color-secondary-foreground: hsl(40 16% 96%);
      --color-muted: hsl(230 14% 16%);
      --color-muted-foreground: hsl(230 8% 62%);
      --color-accent: hsl(244 40% 22%);
      --color-accent-foreground: hsl(244 80% 80%);
      --color-destructive: hsl(0 62% 50%);
      --color-destructive-foreground: hsl(0 0% 100%);
      --color-border: hsl(230 14% 18%);
      --color-border-strong: hsl(230 14% 24%);
      --color-ring: hsl(244 80% 70%);

      /* Dark gradients */
      --gradient-subtle: radial-gradient(circle at 30% 0%, hsl(244 40% 22% / 0.6), transparent 60%);
      --gradient-brand: linear-gradient(135deg, hsl(244 80% 70%), hsl(264 80% 72%));
    }

    /* Base resets + body */
    @layer base {
      *, ::before, ::after { border-color: var(--color-border); }
      html, body, #root { height: 100%; }
      body {
        background: var(--color-background);
        color: var(--color-foreground);
        font-family: var(--font-sans);
        -webkit-font-smoothing: antialiased;
      }
      /* font-feature-settings is written from the runtime pipeline based on the
         active UI font (e.g., Inter character variants). Do NOT hard-code. */
    }

    /* Reduced-motion accessibility — collapse animations + transitions globally.
       Radix UI primitives (Popover, DropdownMenu, etc.) drive open/close via
       data-state animations; the wildcard cascades into them. Verify on first
       feature ship; if a Radix surface still animates, override per-component
       with data-[state=open]:animate-none and data-[state=closed]:animate-none. */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* Custom utilities ported from prototype */
    @utility scrollbar-thin {
      &::-webkit-scrollbar { width: 8px; height: 8px; }
      &::-webkit-scrollbar-thumb { background: var(--color-border-strong); border-radius: 999px; }
      &::-webkit-scrollbar-track { background: transparent; }
    }
    @utility grid-dots {
      background-image: radial-gradient(var(--color-border-strong) 1px, transparent 1px);
      background-size: 22px 22px;
      background-position: -1px -1px;
    }
    @utility text-balance {
      text-wrap: balance;
    }
    @utility font-display {
      font-family: var(--font-sans);
      letter-spacing: -0.02em;
    }
    ```
  - Drop the prototype's `--sidebar-*` tokens (we don't have a sidebar) and the `.tok-*` syntax-highlight classes (live source-pane highlighting uses CodeMirror's per-language packs; rendered code blocks use Shiki — both generate their own class names).
  - Drop `.font-mono-tight` utility (unused outside code-editor chrome).
  - **Keep `.font-display`** — used by the TopBar wordmark, the EmptyState hero heading, and the sign-in card headline. The tighter tracking (`-0.02em`) matters on those brand surfaces; bare `font-sans` doesn't reproduce the look.
- **Verify:**
  - `bun --cwd apps/web run dev` boots; no Tailwind console errors.
  - Visit `/` — body has cream background, dark foreground (light theme is the *default*; dark mode applies later in Task 5 via the inline script).
  - Open devtools, inspect `<body>`, confirm computed `background-color` is `rgb(247, 245, 240)` (the HSL `40 16% 97%` from the prototype) or close to it.

## Task 3: Add the font CSS file and import it

- **What:** Bundle Lato + Geist Mono via `@fontsource-variable` packages.
- **Why:** Tokens reference `"Lato Variable"` and `"Geist Mono Variable"` font families — without the imports, browsers fall through to system fonts.
- **How:**
  - Create `apps/web/src/styles/fonts.css`:
    ```css
    @import "@fontsource-variable/lato";
    @import "geist/font/mono";
    ```
  - Update `apps/web/src/main.tsx` to import it before `globals.css`:
    ```ts
    import "./styles/fonts.css";
    import "./styles/globals.css";
    ```
- **Verify:**
  - `bun --cwd apps/web run dev`; in devtools network tab confirm a request for the Lato variable font file (or it's bundled inline).
  - Body computed font-family includes `"Lato Variable"`.

## Task 4: Implement the prefs store

- **What:** Zustand store with `persist` middleware backing `theme`, `uiFont`, `editorFont` to `localStorage`.
- **Why:** Task 5's anti-flash script and Task 6's `<ThemeProvider>` both read from this store. Source of truth for user prefs.
- **How:**
  - Create `apps/web/src/lib/fonts.ts` with the registries verbatim from the design doc (`UI_FONTS` and `EDITOR_FONTS` constants). Each entry can include an optional `features` field whose value is written to `font-feature-settings` at runtime when the font is active:
    ```ts
    export const UI_FONTS = {
      lato: {
        name: "Lato",
        stack: '"Lato Variable", system-ui, sans-serif',
        features: undefined,
      },
      inter: {
        name: "Inter",
        stack: '"Inter Variable", system-ui, sans-serif',
        features: '"cv11", "ss01", "ss03"', // Inter character variants
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
        features: '"liga", "calt"', // ligatures opt-in for code
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
    ```
  - Create `apps/web/src/lib/prefs.ts` per the design doc snippet (lines 144–166):
    ```ts
    import { create } from "zustand";
    import { persist } from "zustand/middleware";
    import type { UiFontKey, EditorFontKey } from "./fonts";

    type Theme = "light" | "dark" | "system";

    interface PrefsState {
      theme: Theme;
      uiFont: UiFontKey;
      editorFont: EditorFontKey;
      setTheme: (t: Theme) => void;
      setUiFont: (f: UiFontKey) => void;
      setEditorFont: (f: EditorFontKey) => void;
    }

    export const usePrefs = create<PrefsState>()(
      persist(
        (set) => ({
          theme: "dark",
          uiFont: "lato",
          editorFont: "geist-mono",
          setTheme: (theme) => set({ theme }),
          setUiFont: (uiFont) => set({ uiFont }),
          setEditorFont: (editorFont) => set({ editorFont }),
        }),
        { name: "rumi-prefs" },
      ),
    );
    ```
  - Create `apps/web/src/lib/utils.ts` (shadcn's `cn()` helper):
    ```ts
    import { clsx, type ClassValue } from "clsx";
    import { twMerge } from "tailwind-merge";
    export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
    ```
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - Add a one-shot `bun test` file at `apps/web/src/lib/prefs.test.ts`:
    ```ts
    import { describe, expect, it } from "bun:test";
    import { usePrefs } from "./prefs";
    describe("prefs store", () => {
      it("defaults to dark + lato + geist-mono", () => {
        const s = usePrefs.getState();
        expect(s.theme).toBe("dark");
        expect(s.uiFont).toBe("lato");
        expect(s.editorFont).toBe("geist-mono");
      });
    });
    ```
  - `bun test apps/web/src/lib/prefs.test.ts` passes.

## Task 5: Add the anti-flash inline script in `index.html`

- **What:** Inline `<script>` in `<head>` that sets `document.documentElement.dataset.theme` from `localStorage` before React mounts.
- **Why:** Without this, users with saved dark preference see a flash of light theme on first paint (React mount lag). The design doc has this verbatim (lines 113–127).
- **How:**
  - Open `apps/web/index.html`.
  - Replace its contents with:
    ```html
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Rumi</title>
        <script>
          (function () {
            try {
              var raw = localStorage.getItem('rumi-prefs');
              var theme = raw ? (JSON.parse(raw).state || {}).theme : 'dark';
              if (theme === 'system') {
                theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              }
              document.documentElement.dataset.theme = theme || 'dark';
            } catch (_) {
              document.documentElement.dataset.theme = 'dark';
            }
          })();
        </script>
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
      </body>
    </html>
    ```
  - The script reads from the Zustand `persist` middleware key (`rumi-prefs`); on parse failure, falls through to `dark`.
- **Verify:**
  - `bun --cwd apps/web run dev`; visit `/` in a fresh incognito window.
  - Confirm `<html data-theme="dark">` set immediately on load (devtools elements panel).
  - Body background should be the dark surface (HSL `230 20% 9%`), no light-mode flash.

## Task 6: Implement `<ThemeProvider>` and font runtime pipeline

- **What:** A React provider wrapping `next-themes` that mirrors `next-themes` ↔ `usePrefs` and writes font CSS vars on `:root`.
- **Why:** `next-themes` owns the DOM `data-theme` attribute. The prefs store owns persistence. They have to stay in sync. Font swaps happen by mutating `--ui-font` / `--editor-font` on `:root` so Tailwind utilities pick up the change without a rebuild.
- **How:**
  - Create `apps/web/src/lib/theme.ts`:
    ```ts
    import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
    import { useEffect, type ReactNode } from "react";
    import { UI_FONTS, EDITOR_FONTS } from "./fonts";
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

        // Editor font features expose a CSS var that editor surfaces opt into
        // via `font-feature-settings: var(--editor-font-feature-settings, normal)`.
        if (editor.features) root.style.setProperty("--editor-font-feature-settings", editor.features);
        else root.style.removeProperty("--editor-font-feature-settings");
      }, [uiFont, editorFont]);

      return children;
    }

    export function ThemeProvider({ children }: { children: ReactNode }) {
      return (
        <NextThemesProvider
          attribute="data-theme"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <PrefsBridge>{children}</PrefsBridge>
        </NextThemesProvider>
      );
    }
    ```
  - Update `apps/web/src/routes/__root.tsx` to mount the provider:
    ```tsx
    import { Outlet, createRootRoute } from "@tanstack/react-router";
    import { ThemeProvider } from "@/lib/theme";

    export const Route = createRootRoute({
      component: () => (
        <ThemeProvider>
          <Outlet />
        </ThemeProvider>
      ),
    });
    ```
  - Note: `@/*` alias is already configured in `tsconfig.json` (verify).
- **Verify:**
  - `bun --cwd apps/web run dev`; load `/`; confirm `<html data-theme="dark">` (matching prefs default).
  - Open devtools console: `usePrefs.getState().setTheme("light")`. Page should switch to light theme without reload (next-themes flips `data-theme="light"` and tokens repaint).
  - Run `usePrefs.getState().setUiFont("system")`. Body font should change to system-ui without reload.
  - `bun --cwd apps/web run typecheck` passes.

## Task 7: Initialize shadcn/ui

- **What:** Run `bunx shadcn@latest init` against this project; do NOT install any components.
- **Why:** Sets up `components.json` config so future `bunx shadcn@latest add <component>` commands (in auth-and-rooms phase) know our paths, base color, and CSS file.
- **How:**
  - From `apps/web/`, run `bunx shadcn@latest init`.
  - Answer prompts:
    - Style: `default`
    - Base color: `neutral`
    - CSS file: `src/styles/globals.css`
    - Use CSS variables: Yes
    - Path alias: `@/*`
    - React Server Components: No
  - The CLI may write a placeholder `tailwind.config.ts`. Tailwind v4 ignores this file — it's vestigial. After init, open the file: if it contains only `{}` or a default-only stub (no theme overrides, no content array, no plugins), **delete it** to keep the repo clean. If shadcn populates real configuration, leave it but note that v4 won't read it.
  - Confirm `apps/web/components.json` was created.
  - **Do not** run any `add` commands.
- **Verify:**
  - `apps/web/components.json` exists and points at `src/styles/globals.css`.
  - `bun --cwd apps/web run dev` still boots cleanly.
  - `bun --cwd apps/web run typecheck` passes.

## Task 8: Build the verification route

- **What:** Create a temporary `/` route as a demo showing every token category renders correctly. **This route exists only for the design-system phase** — auth-and-rooms Task 11 deletes it and replaces with the dashboard at `_authed/index.tsx`.
- **Why:** This is the smoke test that proves the design system works. Future feature design docs reference this route as "what tokens look like rendered." Scaffolding already shipped a 9-line "Rumi" placeholder at `apps/web/src/routes/index.tsx`; this task replaces it.
- **How:**
  - **Replace** `apps/web/src/routes/index.tsx` (overwrite the existing scaffolding placeholder):
    ```tsx
    import { createFileRoute } from "@tanstack/react-router";
    import { useTheme } from "next-themes";
    import { usePrefs } from "@/lib/prefs";

    export const Route = createFileRoute("/")({
      component: DemoPage,
    });

    function DemoPage() {
      const { theme: nextTheme } = useTheme();
      const setTheme = usePrefs((s) => s.setTheme);

      return (
        <div className="min-h-screen p-8 space-y-8 max-w-3xl mx-auto">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Rumi Design System
            </h1>
            <p className="text-muted-foreground">
              Visual smoke test for tokens, fonts, theme switching.
            </p>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-medium">Buttons (raw tokens, no shadcn yet)</h2>
            <div className="flex gap-2">
              <button className="rounded-lg bg-primary text-primary-foreground px-4 py-2 shadow-sm">
                Primary
              </button>
              <button className="rounded-lg bg-secondary text-secondary-foreground px-4 py-2">
                Secondary
              </button>
              <button className="rounded-lg border border-border px-4 py-2 hover:bg-muted transition-colors">
                Outline
              </button>
              <button className="rounded-lg bg-destructive text-destructive-foreground px-4 py-2">
                Destructive
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-medium">Presence palette</h2>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <div
                  key={n}
                  className={`h-10 w-10 rounded-full ring-2 ring-background`}
                  style={{ background: `hsl(var(--presence-${n}))` }}
                  title={`Presence ${n}`}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-medium">Typography</h2>
            <p className="text-muted-foreground">Muted body text in the UI font.</p>
            <pre className="font-mono text-sm bg-muted p-3 rounded-md">
              {`const greeting = "Hello, world";\nfunction main() { return greeting; }`}
            </pre>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-medium">Brand tile + gradients + animations</h2>
            <div className="flex items-center gap-4">
              {/* TopBar-scale brand tile (7×7 rounded-md) */}
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-brand">
                <span className="text-[11px] font-bold text-primary-foreground">R</span>
              </div>
              <span className="font-display text-base">Rumi (font-display)</span>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-subtle p-8 grid-dots animate-fade-in">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand shadow-float">
                <span className="text-xs font-bold text-primary-foreground">★</span>
              </div>
              <p className="mt-4 text-center text-sm text-muted-foreground text-balance">
                Hero-scale brand tile (12×12 rounded-2xl shadow-float) on
                bg-gradient-subtle with grid-dots overlay and animate-fade-in.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 w-fit">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              <span className="text-[11px] font-medium text-success">Live (animate-pulse-soft)</span>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-medium">Theme toggle (dev-only)</h2>
            <p className="text-sm text-muted-foreground">
              Current: <code className="font-mono">{nextTheme}</code>
            </p>
            <div className="flex gap-2">
              <button onClick={() => setTheme("light")} className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted">
                Light
              </button>
              <button onClick={() => setTheme("dark")} className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted">
                Dark
              </button>
              <button onClick={() => setTheme("system")} className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted">
                System
              </button>
            </div>
          </section>
        </div>
      );
    }
    ```
  - Note: TanStack Router's file-based route generator (`@tanstack/router-plugin/vite`) regenerates `routeTree.gen.ts` automatically on the next dev/build.
- **Verify:**
  - `bun --cwd apps/web run dev` boots; visit `http://localhost:5173/`.
  - All four buttons render with their token-driven backgrounds.
  - 5 presence circles render in distinct colors.
  - Code block renders in Geist Mono (verify via devtools computed font-family).
  - Click "Light" → page flips to light theme without reload, no flash.
  - Click "Dark" → flips back. Reload — dark persists from `localStorage`.
  - Open in fresh incognito → dark by default, no flash of light.
  - `bun --cwd apps/web run build` succeeds.

## Task 9: Pre-commit gate verification

- **What:** Run the full pre-commit gate per CLAUDE.md.
- **Why:** Required before any commit. Catches lint, typecheck, and test regressions introduced by the phase.
- **How:** From repo root, run in order:
  - `bun run check` (Biome lint + format)
  - `bun run typecheck` (all workspaces)
  - `bun test apps packages` (skips `docs/_refs`)
- **Verify:** All three commands exit 0. If `bun run check` reports formatting issues, run `bun run check:write` then re-run `check`.

---

## Suggested commit points

Plans are disposable per CLAUDE.md, but commits should be feature-scoped. Suggested checkpoints if you prefer smaller diffs:

- **After Task 6** (theme + prefs + fonts wired) — foundation ships separately from shadcn init.
- **After Task 9** (full phase complete) — single feature commit covering "design-system" as one logical change.

Single-commit also fine: this whole phase is "feat(web): design system foundation."

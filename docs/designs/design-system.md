# Design System

## Context

The Lovable prototype in `docs/_refs/rumi-collab/` defines Rumi's visual
language: a soft warm-neutral surface, deep indigo-violet primary, warm presence
palette, layered shadows, and Inter + JetBrains Mono typography. We adopt the
prototype's *visual* system almost verbatim while rejecting its code architecture
(react-router-dom, react-query, useState-everywhere, toy markdown renderer).

The design system is the foundation every subsequent UI feature builds on. It
must land before `auth-and-rooms` or `realtime-markdown` work begins because
those features will install shadcn/ui components, use the `font-sans`/`font-mono`
tokens, and rely on the prefs store for theme + font selection.

Two notable deltas from the prototype:

1. **Tailwind v4 native** — port to `@theme` block, drop `tailwind.config.ts`.
2. **Default fonts** — Lato (UI) and Geist Mono (editor), not Inter/JetBrains
   Mono. User-changeable via a registry the future settings UI will read.

## Goals

- Visual fidelity to the prototype's tokens (colors, shadows, motion, spacing,
  radius)
- Native Tailwind v4 idioms (`@theme` block; no JS Tailwind config)
- Lato + Geist Mono as defaults; infrastructure for user-changeable UI and
  editor fonts
- Dark mode default; `next-themes`; respects system preference on first visit
- Zustand-backed prefs store persisted to `localStorage` (theme, uiFont,
  editorFont)
- shadcn/ui initialized with our token system; per-phase component installs
- Demonstration route showing the tokens render correctly

## Non-Goals

- Building the actual Settings UI (separate design doc later)
- Building any feature components (TopBar, Editor, EmptyState — those come in
  feature design docs)
- A `packages/ui` shared workspace (premature; lives in `apps/web` for now)
- Bundling all font options upfront — only Lato + Geist Mono ship in this phase
- Server-side preference sync (per SPEC.md: client-only for MVP)

## Design

### File layout (in `apps/web/`)

```
src/
├── styles/
│   ├── globals.css           # @import tailwindcss + @theme + base + utilities
│   └── fonts.css             # @fontsource imports for Lato + Geist Mono
├── lib/
│   ├── theme.ts              # ThemeProvider wrapper + sync between next-themes and prefs
│   ├── prefs.ts              # Zustand store with persist middleware
│   ├── fonts.ts              # UI_FONTS and EDITOR_FONTS registries
│   └── utils.ts              # shadcn's cn() helper
└── components/
    └── ui/                   # shadcn components (added per phase, not now)
```

### Tailwind v4 token strategy

All design tokens declared in a single `@theme` block in `globals.css`. Tailwind
v4 auto-generates utility classes from `--color-*`, `--shadow-*`, `--radius`,
`--font-*`, etc. Opacity modifiers (`bg-primary/40`) are still supported through
v4's color-mix engine.

Color tokens (light defaults, dark overrides via `[data-theme="dark"]`):

```
background, foreground
surface, surface-elevated
primary, primary-foreground, primary-soft
secondary, secondary-foreground
muted, muted-foreground
accent, accent-foreground
destructive, destructive-foreground
success, warning
border, border-strong
ring
presence-1 … presence-5
```

Other token groups:

- **Radius** — `--radius: 0.75rem`. Components use `rounded-lg`/`-md`/`-sm` which
  derive from this base.
- **Shadows** — `--shadow-xs`, `-sm`, `-md`, `-lg`, `-float`. The prototype's
  values used directly. `shadow-float` is the elevated indigo-tinted shadow
  used by the EmptyState logo tile and the (now tldraw-replaced) drawing
  toolbar; keep it because it's still consumed by the EmptyState hero and
  any future floating panels.
- **Motion** — `--ease-out`, `--ease-spring`, plus three named animations
  (`fade-in`, `scale-in`, `pulse-soft`) declared as v4 `@keyframes` in
  `globals.css`. Tailwind v4 exposes them as `animate-fade-in`,
  `animate-scale-in`, `animate-pulse-soft` utilities via the `--animate-*`
  theme keys. See "Animations" below.
- **Gradients** — `--gradient-subtle` and `--gradient-brand` declared as
  background-image values exposed to Tailwind v4 via the
  `--background-image-*` theme keys, so the EmptyState hero (`bg-gradient-subtle`)
  and the TopBar brand tile (`bg-gradient-brand`) resolve. See
  "Gradients" below.
- **Fonts** — `--font-sans` and `--font-mono` declared with `var()` indirection
  so the prefs store can override them at runtime by setting CSS variables on
  `:root`. See "Font runtime pipeline" below.

Exact HSL values come verbatim from `docs/_refs/rumi-collab/src/index.css`.

### Animations

The prototype defines three named animations on top of Tailwind's defaults:
`fade-in` (250ms, ease-out, translateY(4px) → 0), `scale-in` (180ms,
spring, scale(0.96) → 1), and `pulse-soft` (2.4s, infinite, opacity
0.5 ↔ 1). All three are actively consumed:

- `animate-fade-in` — EmptyState hero on first render
- `animate-scale-in` — Tab `+` popover on open, settings dropdown on
  open, future floating panels
- `animate-pulse-soft` — TopBar "Live" pill dot when connected

Because we drop `tailwindcss-animate` in favor of v4 native, we declare
the keyframes ourselves in `globals.css` and register them in `@theme`:

```css
@theme {
  --animate-fade-in: fade-in 250ms var(--ease-out) both;
  --animate-scale-in: scale-in 180ms var(--ease-spring) both;
  --animate-pulse-soft: pulse-soft 2.4s ease-in-out infinite;
}

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
```

`prefers-reduced-motion` handling: a media-query block in `globals.css`
collapses these to instant-state changes for users who request reduced
motion, avoiding the prototype's accessibility miss:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Radix UI primitives (Popover, DropdownMenu, Dialog, AlertDialog) drive
their open/close animations via `data-state` attributes and rely on
CSS `animation-name` / `animation-duration`. The wildcard rule above
cascades into them and reduces those animations to ~instant. Verify on
first feature ship; if a particular Radix surface still animates
visibly under reduced-motion, override with a `data-[state=open]:animate-none
data-[state=closed]:animate-none` utility on that component.

### Gradients

Two gradients carry visual weight in the prototype:

- `--gradient-subtle` — subtle radial behind the EmptyState hero
- `--gradient-brand` — indigo-violet brand gradient on the TopBar logo
  tile and (potentially) auth screens

Tailwind v4 doesn't auto-derive `bg-gradient-*` utilities from arbitrary
`--gradient-*` tokens. We use v4's `--background-image-*` theme keys so
both resolve as utilities:

```css
@theme {
  --background-image-gradient-subtle: var(--gradient-subtle);
  --background-image-gradient-brand: var(--gradient-brand);
}

:root {
  --gradient-subtle: radial-gradient(...);
  --gradient-brand: linear-gradient(...);
}
[data-theme="dark"] {
  --gradient-subtle: radial-gradient(...);
  --gradient-brand: linear-gradient(...);
}
```

Exact gradient values come verbatim from the prototype.

### Dark mode default

The prefs store defaults to `theme: "dark"`. `next-themes` is configured with
`attribute="data-theme"`, `defaultTheme="dark"`, `enableSystem: true`. On first
visit, `next-themes` checks `localStorage` first, then system preference (if
user hasn't picked yet), then falls back to dark.

A small inline script in `index.html` reads `localStorage.theme` and sets
`document.documentElement.dataset.theme` *before* React mounts, to prevent a
flash of light mode on first paint when the user has saved a dark preference.
This is the standard `next-themes`-on-Vite pattern.

The script verbatim (placed in `<head>` before any module scripts):

```html
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
```

The script reads from the Zustand `persist` middleware key (`rumi-prefs`)
and falls through to `dark` on any error. Helmet's `script-src` CSP must
allow `'unsafe-inline'` for this to execute (the auth-and-rooms phase
configures Helmet accordingly).

### Prefs store

`src/lib/prefs.ts`:

```ts
type Theme = "light" | "dark" | "system";
type UiFontKey = keyof typeof UI_FONTS;
type EditorFontKey = keyof typeof EDITOR_FONTS;

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

### Font runtime pipeline

1. App boot: prefs store hydrates from `localStorage`. Defaults to Lato + Geist
   Mono if absent.
2. `<ThemeProvider>` (in `lib/theme.ts`) subscribes to the prefs store and runs
   an effect:
   ```ts
   const root = document.documentElement;
   root.style.setProperty("--ui-font", UI_FONTS[uiFont].stack);
   root.style.setProperty("--editor-font", EDITOR_FONTS[editorFont].stack);

   const uiFeatures = UI_FONTS[uiFont].features;
   if (uiFeatures) root.style.setProperty("font-feature-settings", uiFeatures);
   else root.style.removeProperty("font-feature-settings");

   const editorFeatures = EDITOR_FONTS[editorFont].features;
   if (editorFeatures) root.style.setProperty("--editor-font-feature-settings", editorFeatures);
   else root.style.removeProperty("--editor-font-feature-settings");
   ```
3. Tailwind utilities `font-sans` and `font-mono` resolve to these CSS vars via
   `--font-sans`/`--font-mono` declared in `@theme`. Editor surfaces apply
   `font-feature-settings: var(--editor-font-feature-settings, normal)` directly
   so ligatures opt-in only in code editors.
4. The prefs store and `next-themes` are kept in sync: changing `prefs.theme`
   calls `next-themes`'s `setTheme()`; on mount, `prefs.theme` seeds the initial
   theme. `next-themes` is the source of truth for the DOM `data-theme` attribute;
   the prefs store is the source of truth for persistence.

### Font registry (`src/lib/fonts.ts`)

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
  "geist-mono": { name: "Geist Mono", stack: '"Geist Mono Variable", ui-monospace, monospace' },
  "jetbrains-mono": { name: "JetBrains Mono", stack: '"JetBrains Mono Variable", ui-monospace, monospace' },
  "fira-code": { name: "Fira Code", stack: '"Fira Code Variable", ui-monospace, monospace', features: '"liga", "calt"' },
  "ibm-plex-mono": { name: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace' },
  "system-mono": { name: "System Mono", stack: "ui-monospace, monospace" },
} as const;
```

The font runtime pipeline writes the active UI font's `features` value
to `font-feature-settings` on `:root`. When the active font has no
`features`, the property is removed (not set to `normal`) so the
browser's default applies. Fira Code's ligature setting only affects
the editor font; it's a property of the editor font registry, not the
UI font registry, and `--editor-font-feature-settings` is a separate
custom property scoped to the editor surface.

Only `lato` and `geist-mono` ship as bundled `@fontsource-variable` packages in
this phase. Other entries are registry placeholders — they fall through to the
`system-ui`/`ui-monospace` fallback until the settings UI is built and we decide
which to bundle vs lazy-load. The `system` and `system-mono` entries are always
usable as zero-cost defaults.

### Bundled font packages

```
@fontsource-variable/lato
geist                   (Vercel's Geist + Geist Mono; ships variable fonts)
```

Imported once in `src/styles/fonts.css`:

```css
@import "@fontsource-variable/lato";
@import "geist/font/mono";
```

### shadcn/ui setup

Run `bunx shadcn@latest init` once with:

| Prompt | Answer |
|---|---|
| Style | `default` |
| Base color | `neutral` (we override colors via `@theme`) |
| CSS file | `src/styles/globals.css` |
| Use CSS variables | Yes |
| Path alias | `@/*` (already configured) |
| React Server Components | No |

The CLI may write a placeholder `tailwind.config.ts`. Tailwind v4 doesn't read
it; delete it post-init if empty.

**Init only in this phase.** Run `bunx shadcn@latest init` and verify the
`@/*` import alias and CSS variables wire up against `globals.css`. Do not
run `bunx shadcn@latest add <component>` here. The auth-and-rooms phase
runs the first `add` commands (Button, Input, Label, Avatar, DropdownMenu,
Dialog, AlertDialog, Sonner, Skeleton).

### Custom utilities (port from prototype)

Four utilities the prototype defines that we re-declare in `globals.css`:

- `.scrollbar-thin` — narrower scrollbars with `border-strong` thumbs
- `.grid-dots` — radial-dot pattern background, used by the empty-state hero
- `.text-balance` — `text-wrap: balance` (for headings)
- `.font-display` — `font-family: var(--font-sans); letter-spacing: -0.02em;`
  used by the wordmark in TopBar and the EmptyState hero heading. Kept (not
  dropped as previously planned) because the prototype's brand surfaces rely
  on the tighter tracking treatment.

The prototype's `.font-mono-tight` utility is dropped — it's unused outside
code-editor chrome and the design-system's `--font-mono` covers the cases.

The prototype's `.tok-*` syntax-highlighting CSS classes (`.tok-key`,
`.tok-str`, `.tok-num`, `.tok-com`, `.tok-fn`, `.tok-tag`) are **not** ported.
Live source-pane highlighting in the unified Tab editor uses CodeMirror's
`HighlightStyle` (declared in `realtime-markdown.md`); rendered code blocks
inside markdown previews and any static code-block render uses Shiki. Both
mechanisms generate their own class names — there's nothing in the design
system layer that needs to know about them. The design tokens (`--color-foreground`,
`--color-muted-foreground`, `--color-primary`, etc.) still drive the *colors*
indirectly through the editor theme and the Shiki theme bridge.

### Brand tile

The "Sparkles" tile in `bg-gradient-brand` appears in three contexts at
two scales. Pin the dimensions here so consumers stay consistent:

| Context | Outer | Inner icon |
|---|---|---|
| TopBar wordmark | 7×7 `rounded-md` | `h-3.5 w-3.5 strokeWidth=2.5 text-primary-foreground` |
| EmptyState hero / sign-in card | 12×12 `rounded-2xl shadow-float` | `h-5 w-5 strokeWidth=2.5 text-primary-foreground` |

Both use `bg-gradient-brand` and center the icon via flex.

### Code-block typography

Even though syntax highlighting lives outside the design system layer, two
shared concerns are pinned here so editor and preview render consistently:

- Code block container: `bg-muted/40` background, `rounded-md` corners,
  `border border-border` (1px), `p-4` for fenced blocks in the markdown
  preview, no border for the live editor source pane. Inline code:
  `bg-muted/60`, `rounded` (`--radius / 3`), `px-1`, `py-0.5`.
- Editor + preview source font: `--font-mono` at `13.5px` line-height
  `1.6` for the editor, `14.5px` line-height `1.65` for rendered code
  blocks (slightly larger to match prose density).

Component-side overrides (CodeMirror theme, Shiki theme) reference these
tokens; the design system doesn't know about CodeMirror or Shiki directly.

### Responsive scope

Per SPEC.md "Responsive scope" section, design tokens are width-agnostic
but components use Tailwind responsive utilities (`md:`/`lg:` breakpoints)
for layout. Tier hierarchy:

- Desktop (≥ 1024px) is the design target for every component.
- Tablet (768–1023px) gets natural responsive layout via Tailwind
  defaults (e.g., dashboard grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`).
  No tablet-specific components.
- Phone (< 768px) gets best-effort stacking. shadcn Dialog goes
  full-screen on small viewports by default; we don't override.

No mobile-specific tokens (no different font sizes per breakpoint, no
touch-target overrides). The post-MVP drawing canvas phase will introduce
tablet-specific work when it lands.

### Verification route

A demo route at `/` (replacing the current "Rumi" placeholder) shows:

- A card with the primary button, ghost button, and outline button
- Muted text + heading example using `font-display` for the heading
- 5 presence avatars in `--color-presence-1` through `-5`
- A `font-mono` code block in the current editor font
- A theme toggle button (dev-only — the real settings UI lives at `/settings`,
  not built in this phase)
- A small "Live" pill demo using `animate-pulse-soft`
- A floating panel demo using `animate-scale-in` triggered by a button
- A hero block using `bg-gradient-subtle` + `grid-dots` overlay (visual ref:
  EmptyState pattern)
- A logo tile using `bg-gradient-brand` with `shadow-float`

This route serves as a visual smoke test. After this phase ships, every feature
design doc will reference it as the source of truth for "what tokens look like
rendered."

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tailwind theming | Native v4 `@theme` block in CSS | No JS config; smaller bundle; v4 idioms; future-proof |
| Dark mode toggle | `next-themes` (5KB) | Industry standard; system-pref detection; SSR-safe (irrelevant for Vite but harmless); same as the prototype |
| Default theme | `dark`, with `enableSystem: true` | Per user direction; matches developer-tool aesthetic |
| Prefs storage | Zustand + `persist` middleware → `localStorage` | Per SPEC.md; no DB schema; no auth round-trip; fast |
| Source of truth (theme) | `next-themes` for DOM, prefs store for persistence | `next-themes` handles the SSR-safe DOM swap; we mirror its state into our store |
| UI font default | Lato (`@fontsource-variable/lato`) | Per user direction; humanist sans, warmer than Inter |
| Editor font default | Geist Mono (via `geist` package) | Per user direction; modern, clean, lighter than JetBrains |
| Font extensibility | Runtime CSS-var swap from a registry | One Tailwind utility (`font-sans`/`font-mono`); zero rebuild cost; cheap to add fonts later |
| shadcn install model | Per-phase, not upfront | Avoid 40 unused components in repo; one component at a time as features need them |
| Design system home | `apps/web/src/styles/` and `apps/web/src/lib/` | No second consumer; `packages/ui` is premature |
| Token source | `docs/_refs/rumi-collab/src/index.css` HSL values verbatim | Visual fidelity to the prototype; no need to redesign |
| Custom Tailwind plugins | None (drop `tailwindcss-animate`) | v4 has native animation primitives; one less dep. Named animations (`fade-in`, `scale-in`, `pulse-soft`) declared as native `@keyframes` + `@theme --animate-*` keys |
| Reduced motion | `prefers-reduced-motion` media query collapses transitions/animations globally | Accessibility miss in the prototype; cheap to fix |
| Gradients | Two `@theme --background-image-*` keys (`gradient-subtle`, `gradient-brand`) | Tailwind v4 doesn't auto-expose arbitrary `--gradient-*` tokens; the `--background-image-*` keys are the v4 idiom for utility-class gradients |
| Code-block highlighting | Shiki for static rendering; CodeMirror per-language packs for live editing — both consume design-system color tokens via theme bridges | Detailed in `realtime-markdown.md`. Design system doesn't ship `.tok-*` classes; both highlighters generate their own class names. |
| Dropped from prototype | `react-query`, `react-hook-form`, `react-router-dom`, `cmdk`, `vaul`, `embla-carousel`, `recharts`, `input-otp`, `react-day-picker`, `date-fns`, `tailwindcss-animate` | Lovable bundle bloat; none are used by anything we're building |

## Rejected Alternatives

- **Tailwind v3 with the prototype's `tailwind.config.ts` copied verbatim** —
  fastest initial port, but contradicts SPEC.md (says v4) and puts us on a
  deprecated stack. Future maintenance burden grows over time.
- **Tailwind v4 with the v3 config compat layer** — works mechanically but
  you don't get `@theme` benefits, and you keep a JS config file forever.
  Half-port; pick one model.
- **`packages/ui` workspace from the start** — premature abstraction; one
  consumer (`apps/web`) and no concrete plan for `apps/mobile`. Refactor when
  there's a second consumer.
- **Roll our own dark-mode hook** — saves 5KB; loses system-pref detection,
  the inline-script anti-flash pattern, and the in-band `useTheme` hook.
  `next-themes` is the standard for ~5 lines of integration.
- **Bundle every font option in the registry upfront** — adds ~500KB+ for
  fonts users probably won't pick. Bundle only Lato + Geist Mono now;
  lazy-load others when the settings UI lands.
- **Server-synced `user_preferences` table** — doubles auth-and-rooms surface
  area for negligible MVP gain. Multi-device pref sync is a real feature, not
  an MVP necessity.
- **Drop dark mode entirely for MVP** — would simplify this phase but the
  user explicitly asked for dark default. Cost is ~20 minutes of work.
- **Use Radix Primitives directly instead of shadcn/ui** — more control, more
  work. shadcn is the dominant 2026 pattern for solo MVPs; matches the
  prototype.

## Edge Cases & Constraints

- **Flash of wrong theme on first paint.** `next-themes` `ThemeProvider`
  reads `localStorage` synchronously on mount, but React still has to mount
  before the `data-theme` attribute is set. Mitigation: a 4-line inline
  script in `index.html` reads `localStorage.theme` and sets
  `document.documentElement.dataset.theme` *before* React boots. Standard
  `next-themes`-on-Vite recipe.
- **Font flash (FOIT/FOUT).** `@fontsource-variable` packages default to
  `font-display: swap`. Brief unstyled flash is acceptable; Lato and Geist
  Mono are close enough to system fallbacks that the swap is minimal.
- **Tailwind v4 + shadcn `tailwind.config.ts` artifact.** The shadcn CLI
  expects a config file. v4 doesn't read it. The CLI may write a stub —
  delete if empty, or check it in if shadcn future-versions need it.
- **`prefs.theme = "system"` semantics.** `next-themes` handles this: when
  `theme === "system"`, it watches `prefers-color-scheme` and updates
  `data-theme` automatically. The prefs store stores the literal `"system"`
  string; we don't try to resolve it ourselves.
- **Prefs store hydration race.** Zustand's `persist` middleware hydrates
  asynchronously on mount. There's a brief window where `prefs.theme` is the
  initial in-memory default ("dark") before `localStorage` overwrites it.
  This is fine because `next-themes` is the source of truth for the DOM
  attribute and handles its own hydration. The prefs store catches up
  shortly after; no visible glitch.
- **Token additions later.** Adding a new color token = one line in `@theme`
  + (if needed) one line in the `[data-theme="dark"]` override. No utility
  classes to register. Tailwind v4 generates them automatically.
- **No font preview in registry without bundling.** Users selecting Inter
  before we bundle it will see system-ui fallback. Acceptable for MVP; the
  settings UI design doc decides whether to lazy-load fonts on selection or
  preload all of them.

## Open Questions

None. All decisions resolved during brainstorm. The next two design docs
(`auth-and-rooms`, `realtime-markdown`) consume this design system as
infrastructure.

# Landing Page Plan

> **Goal:** Public landing page at `/` for unauthenticated visitors with hero (word-swap), interactive sandbox, features grid, pricing section, footer, cookie consent, and Plausible analytics. Authenticated visitors continue to redirect to the dashboard.
> **Design doc:** `docs/designs/landing-page.md`

## Current state (verified against codebase)

What's already in place:
- `/` is currently auth-guarded by `_authed.tsx`; the dashboard lives at `routes/_authed/index.tsx` — `apps/web/src/routes/_authed.tsx:6-11`
- `routes/__root.tsx` is a thin shell (`ThemeProvider` + `TooltipProvider` + `<Outlet />` + `<ThemedToaster />`) — `apps/web/src/routes/__root.tsx`
- `/upgrade` page already exists with three plan cards (Free/Pro/Max). Pricing numbers are: Free $0, Pro $8, Max $20. Features per tier are hardcoded — `apps/web/src/routes/_authed/upgrade.tsx:13-44`
- `/sign-in` accepts `?next=<path>` — `apps/web/src/routes/sign-in.tsx:10`
- `routes/r.$slug.tsx` is top-level (not under `_authed`), so guest access already works
- TopBar (`components/topbar.tsx`) handles all internal pages — landing will need its own simpler nav, NOT the existing TopBar (which assumes a logged-in user with `useSession`)
- CodeMirror, Yjs, tldraw are present in the editor route — must NOT be eagerly imported into the landing chunk
- The auth flow uses Supabase + `useSession` Zustand store with `status: 'loading' | 'authenticated' | 'anonymous'`. The "loading" state matters here — the landing page renders during `loading`, so the redirect-to-dashboard guard must wait for `authenticated`

The design doc assumed pricing CTAs would go to the Billing tab with checkout pre-selection. Reality is `/upgrade` is a separate page; this plan routes pricing CTAs there. The plan is sequenced so it can ship before billing-plan.md ships — pricing card CTAs route to `/upgrade` (which exists), and the buttons there will become functional when the billing plan ships.

## Phase 1: Routing — make `/` public

**Gate:** Unauthenticated visitors see the landing page; authenticated visitors continue to the dashboard.

### Task 1: Move dashboard from `/_authed/` (path `/`) to `/_authed/dashboard`? — NO. Keep dashboard at `/_authed/`, change the resolution at `/`.

The dashboard is already at the auth-guarded layout's index (`/_authed/index.tsx`). We need a **standalone public route at `/`** that, when authenticated, redirects to the dashboard, and otherwise renders the landing page.

TanStack Router's filesystem routing: `routes/index.tsx` would conflict with `routes/_authed/index.tsx` because both resolve to `/`. The fix is to treat `/_authed` as a layout route (already a path-less segment due to the underscore) — its child `index.tsx` resolves to `/`. We add a new `routes/index.tsx` at the same level, but TanStack Router resolves layout routes by checking the `_authed` `beforeLoad` first — that's what currently redirects unauthed users to `/sign-in`.

**Simpler plan**:

- The `/_authed/index.tsx` becomes `/_authed/dashboard.tsx` so the dashboard is now `/_authed/dashboard` (path: `/dashboard`)
- A new `routes/index.tsx` (public) renders the landing page. Its `beforeLoad` checks session: if authenticated, redirect to `/dashboard`.
- Update every `<Link to="/">` in dashboard-relevant code to `<Link to="/dashboard">` where it meant the dashboard, and keep `<Link to="/">` only when it really means the landing page.

- **What:** Move the dashboard to `/dashboard` and add a public landing route at `/`.
- **Why:** This is the cleanest split that doesn't fight TanStack Router's filesystem routing.
- **How:**
  - Rename `apps/web/src/routes/_authed/index.tsx` → `apps/web/src/routes/_authed/dashboard.tsx`. Update the `createFileRoute` path:
    ```ts
    export const Route = createFileRoute("/_authed/dashboard")({ component: DashboardPage });
    ```
  - Create `apps/web/src/routes/index.tsx`:
    ```ts
    import { createFileRoute, redirect } from "@tanstack/react-router";
    import { useSession } from "@/lib/auth";
    import { LandingPage } from "@/components/landing/landing-page";

    export const Route = createFileRoute("/")({
      beforeLoad: () => {
        const { status } = useSession.getState();
        if (status === "authenticated") {
          throw redirect({ to: "/dashboard" });
        }
        // For "loading", let the route render; the LandingPage component
        // will not flash because we render under a thin skeleton until status
        // resolves (see Task 2). For "anonymous", render the landing page.
      },
      component: LandingPage,
    });
    ```
  - In TopBar, the existing `<Link to="/">` (line 55) currently points to landing. For authenticated users it will redirect them via `beforeLoad` → fine. For sign-in / room-guest links, "/" still routes to landing as expected.
  - **Required audit step before merging:** grep `apps/web/src/` for every `to: "/"` and every `<Link to="/">`. For each match, decide:
    - "Meant landing" → keep
    - "Meant dashboard" → change to `to: "/dashboard"`
  - Concretely audit these files (verified to exist or referenced from other files):
    - `apps/web/src/components/topbar.tsx:55` — brand logo link. Currently goes to `/`. Authed users get redirected to `/dashboard` by `beforeLoad` — keep as `/`.
    - `apps/web/src/routes/r.$slug.tsx:37` — bounces a signed-in user with a forbidden/not_found room. Comment explicitly says "back on the dashboard." **Change to `nav({ to: "/dashboard" })`.**
    - `apps/web/src/lib/auth.ts` — verify `signOut` redirects to `/sign-in` (likely yes; confirm).
    - `apps/web/src/routes/auth/callback.tsx:7` — `next` defaults to `"/"`. Change to `"/dashboard"` so post-OAuth lands directly on the dashboard (one redirect, not two).
    - `apps/web/src/routes/_authed.tsx:21` — uses `next: "/"`. Change to `next: "/dashboard"`.
    - `apps/web/src/routes/_authed/index.tsx` (will become `_authed/dashboard.tsx`) — internal links and `useNavigate` calls in this file.
    - `apps/web/src/routes/sign-in.tsx:10` — `validateSearch` defaults `next` to `"/"`. Change to `"/dashboard"`.
    - `apps/web/src/stores/rooms.ts` — any `navigate({ to: "/" })` that meant "back to dashboard" after a delete.
- **Verify:**
  - Sign out → land on `/sign-in`; visit `/` → see landing page (not a redirect loop).
  - Sign in → callback sets `next` to `/dashboard`; visitor sees the dashboard, not landing.
  - `bun run typecheck` passes (TanStack Router's generated `routeTree.gen.ts` will need to regenerate — `bun --cwd apps/web run dev` regenerates it on save).

### Task 2: Handle the `loading` auth state on `/`

- **What:** Avoid flashing the landing page for an authenticated user during the `loading` window.
- **Why:** `useSession.getState()` in `beforeLoad` runs synchronously; on initial page load before Supabase resolves the session, `status === "loading"`. The `beforeLoad` redirect only fires when status is already `"authenticated"`. So an authenticated user reloading `/` sees the landing for ~200ms before the redirect kicks in.
- **How:**
  - In `LandingPage`, subscribe to the session store and short-circuit:
    ```tsx
    const status = useSession((s) => s.status);
    if (status === "loading") return <Splash />;
    if (status === "authenticated") {
      return <Navigate to="/dashboard" replace />;
    }
    return <RealLandingContent />;
    ```
    `<Splash />` is a tiny logo-centered placeholder (use existing `logoT` asset). `<Navigate>` is from `@tanstack/react-router`.
  - The `beforeLoad` redirect (Task 1) still serves soft navigations and pre-rendered cases; the in-component check covers initial page load.
- **Verify:** Hard reload while signed in on `/`: no visible landing-page flash. Hard reload while signed out: landing renders immediately (no splash flash, since `status` resolves to `"anonymous"` quickly).

## Phase 2: Components — landing page composition

**Gate:** Static landing page renders end-to-end with hero, features, pricing, footer, and a placeholder for the sandbox. No JS-blocked render of the editor surfaces yet.

### Task 3: Folder structure

```
apps/web/src/components/landing/
  landing-page.tsx          composition root
  landing-nav.tsx           sticky nav (logo, pricing/github, sign-in)
  landing-footer.tsx        footer columns
  hero.tsx                  hero with word-swap + CTAs
  word-swap.tsx             reusable cycling text (pauses on user interaction)
  features-grid.tsx         4 feature cards
  pricing-section.tsx       3-card pricing + interval toggle + comparison table
  cookie-banner.tsx         bottom-right consent banner
  cookie-preferences.tsx    "Manage preferences" modal
  sandbox/                  see Phase 3
```

### Task 4: Build `landing-nav.tsx`

- **What:** Sticky top nav that's NOT the editor `TopBar` (which depends on `useSession`).
- **Why:** Landing nav is for unauthenticated users; it has its own concerns (logo, anchor links, sign-in CTA).
- **How:**
  - Mirror the `TopBar` brand block: same logo image and font, but the right side is just `<Pricing>` (anchor `#pricing`), `<GitHub>` (external link), and a primary `<Sign in>` button → `/sign-in`.
  - Mobile: collapse links into a hamburger (use a `Sheet` or `Popover` from existing UI primitives).
- **Verify:** Renders in light + dark themes. Sign-in click goes to `/sign-in`.

### Task 5: Build `hero.tsx` and `word-swap.tsx`

- **What:** Hero with the rotating word in the headline, subheadline, primary "Start for free" CTA, secondary "Try it" CTA that scrolls to the sandbox, "No credit card required" subtext.
- **Why:** First-impression section.
- **How:**
  - `<WordSwap words={["technical", "research", "team"]} interval={2500} />` cycles the cycled word. Words are absolute-positioned in a fixed-width container (CSS: `inline-block w-[<longest>ch]`) to prevent layout shift. Implementation:
    ```tsx
    const [i, setI] = useState(0);
    const [paused, setPaused] = useState(false);
    useEffect(() => {
      if (paused) return;
      const id = setInterval(() => setI((p) => (p + 1) % words.length), interval);
      return () => clearInterval(id);
    }, [paused, words.length, interval]);
    useEffect(() => {
      const handler = () => setPaused(true);
      window.addEventListener("scroll", handler, { once: true });
      window.addEventListener("click", handler, { once: true });
      window.addEventListener("keydown", handler, { once: true });
      return () => {
        window.removeEventListener("scroll", handler);
        window.removeEventListener("click", handler);
        window.removeEventListener("keydown", handler);
      };
    }, []);
    ```
    Crossfade with `transition-opacity duration-300` and absolute positioning of two layered spans, swapping which is opaque.
  - Primary CTA: `<Link to="/sign-in" search={{ next: "/dashboard" }}>` (CTA copy: "Start for free")
  - Secondary CTA: button that smooth-scrolls to `#sandbox`
- **Verify:** The headline width doesn't shift when the word changes. The cycle stops on first scroll/click/keypress.

### Task 6: Build `features-grid.tsx`

- **What:** 4 feature cards in a 2x2 grid (desktop), single column on mobile.
- **Why:** Surfaces the value props without marketing fluff.
- **How:** Static JSX — icon (lucide), heading, one-sentence description for each:
  - Real-time sync — "See edits as they happen. Conflict-free CRDT under the hood."
  - Markdown + code tabs — "Mix prose, code, and drawings in one room. ~150 languages."
  - Drawing boards — "Whiteboard-grade collaborative canvas powered by tldraw."
  - Guest access — "Share a link; no signup required for read-only viewers."
  - Each card uses existing border/surface tokens (`rounded-xl border bg-surface p-6`).
- **Verify:** Renders responsively.

### Task 7: Build `pricing-section.tsx`

- **What:** Three-column card layout matching the `/upgrade` page's visual style; monthly/yearly toggle above with "save 17%" badge on yearly.
- **Why:** Pricing visibility is part of the landing's job; mirrors the `/upgrade` experience.
- **How:**
  - Reuse the plan data shape from `apps/web/src/routes/_authed/upgrade.tsx:13-44`. Either:
    - **Option A (preferred):** extract the `PLANS` array into `apps/web/src/lib/plans.ts` and import from both places. Single source of truth for the visible feature bullets.
    - Option B: duplicate the array (simpler, smaller blast radius).
  - Add a `useState<"monthly" | "yearly">("monthly")` toggle. When yearly is selected, show $80/yr (Pro) and $200/yr (Max); the Free card stays at $0.
  - CTAs:
    - Free → `<Link to="/sign-in" search={{ next: "/dashboard" }}>Get started`
    - Pro/Max → `<Link to="/sign-in" search={{ next: "/upgrade?plan=pro" }}>Upgrade` (or `?plan=max`)
  - Below the cards: a feature comparison table. Column headers: Feature, Free, Pro, Max. Rows: rooms, tabs/room, concurrent users, file uploads, support, etc. Numbers from `apps/server/src/rooms/plan.ts`. **Static rendering — do not import server code.** Hardcode the values; if they ever change, update both places.
  - The pricing-tiers feature comparison rows can be the same content as `pricing-tiers.md` (look it up at implementation time).
- **Verify:** The pricing section toggle works; clicking Pro CTA while signed-out goes to sign-in with `?next=/upgrade?plan=pro`. After OAuth, the `/upgrade` page (per billing-plan Task 11) reads `?plan=pro` and pre-selects that card.

### Task 8: Build `landing-footer.tsx`

- **What:** Footer with three columns + copyright + GitHub icon.
- **Why:** Standard landing-page anatomy.
- **How:**
  - Left column: Rumi logo + tagline + © 2026.
  - Center columns:
    - Product: Pricing (anchor `#pricing`), Sign in (`/sign-in`)
    - Legal: Privacy (`/privacy`), Terms (`/terms`), Cookie preferences (re-opens modal)
    - Company: GitHub (external)
  - **Defer "Status" link** — design doc explicitly says don't ship a dead link.
  - **Privacy + Terms routes** are the responsibility of the misc-deferred plan's "Legal pages" task. If those routes aren't ready when this lands, point the links to `/privacy` / `/terms` anyway — TanStack Router will 404 until they exist; better to add the routes than soften the links.
- **Verify:** Cookie preferences link opens the modal (Task 12).

### Task 9: Compose `landing-page.tsx`

- **What:** The route component that stitches nav + hero + sandbox + features + pricing + footer.
- **Why:** Single component for the route to render.
- **How:**
  - Standard vertical scroll. Each section is `id="hero" | "sandbox" | "features" | "pricing"`.
  - Use Intersection Observer for one-shot fade-in transitions (subtle `translate-y` + `opacity` reveal). Implement once, reuse via a `<Reveal>` wrapper component.
  - Mount `<CookieBanner />` last; it manages its own visibility based on `localStorage`.
- **Verify:** Page scrolls smoothly. Anchor links work. Reveal animations fire only once.

## Phase 3: Interactive sandbox

**Gate:** Sandbox lazy-loads, doesn't block hero render, and seeds with the markdown + tldraw content.

### Task 10: Sandbox shell + lazy loading

- **What:** A two-pane component that lazy-loads CodeMirror + tldraw via `React.lazy` + Intersection Observer.
- **Why:** Heavy editor bundles must not block the hero render.
- **How:**
  - File structure:
    ```
    apps/web/src/components/landing/sandbox/
      sandbox.tsx              shell with skeleton + lazy children
      sandbox-markdown.tsx     CodeMirror bound to a local Y.Text + a small preview render
      sandbox-drawing.tsx      tldraw mounted with seed shapes
      seed.ts                  markdown + shape definitions
    ```
  - `sandbox.tsx`:
    ```tsx
    const SandboxMarkdown = lazy(() => import("./sandbox-markdown"));
    const SandboxDrawing = lazy(() => import("./sandbox-drawing"));

    export function Sandbox() {
      const ref = useRef<HTMLDivElement>(null);
      const [ready, setReady] = useState(false);
      useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setReady(true);
            obs.disconnect();
          }
        }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
      }, []);

      return (
        <section id="sandbox" ref={ref} className="...">
          <div className="text-center mb-4 text-sm text-muted-foreground">
            This is a single-user preview. Sign up to collaborate in real time.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[400px]">
            {ready ? (
              <Suspense fallback={<SandboxSkeleton />}>
                <SandboxMarkdown />
                <SandboxDrawing />
              </Suspense>
            ) : (
              <SandboxSkeleton />
            )}
          </div>
        </section>
      );
    }
    ```
  - **Hard rule:** the sandbox files must NOT import from `@/components/editor/*`, `@/lib/collab/*`, or `apps/web/src/lib/drawing/yjs-store.ts`. Those files import Hocuspocus and would pull the entire collaboration stack into the landing bundle. Build the sandbox surfaces from raw CodeMirror + raw tldraw + a fresh `Y.Doc` (no provider).
- **Verify:** With `vite build`, inspect the chunk graph. Expectations:
  - Sandbox chunks **WILL** include `yjs` and `y-protocols` (pulled by `y-codemirror.next`). That's fine.
  - Sandbox chunks **MUST NOT** include `@hocuspocus/provider` or `@hocuspocus/server`.
  - Hero/entry chunk should not include `yjs` (since the sandbox is lazy).
  - Hero chunk size: aim for < 200KB gzipped including React + nav/footer/pricing.
  - **Importing `lib/markdown/render.ts` is OK** — verified it imports unified/remark/rehype/Shiki (no Yjs/Hocuspocus). Shiki is the heaviest dep but is already lazy-loaded via `lib/shiki.ts`.

### Task 11: Sandbox content

- **What:** Wire the markdown CodeMirror surface and the tldraw surface with the seed content from `landing-page.md`.
- **Why:** The page sells the editor by letting visitors type into it.
- **How:**
  - **Markdown side (`sandbox-markdown.tsx`):**
    - Create a fresh `Y.Doc` with a `Y.Text` named `"content"`. Seed it via `ytext.insert(0, MARKDOWN_SEED)`.
    - Mount CodeMirror with `yCollab(ytext, null)` (no awareness — single-user). Use the same theme + extensions as `apps/web/src/components/editor/tab-cm.tsx` but inlined here (don't import the editor file).
    - Render a small preview pane on a debounced `ytext.observe`, using the existing `lib/markdown/render.ts` pipeline (this is fine to import — it's a pure markdown renderer with no Yjs/Hocuspocus dependency; verify when implementing).
    - "Reset" button: clears the `Y.Text` and re-inserts the seed.
  - **Drawing side (`sandbox-drawing.tsx`):**
    - Mount `<Tldraw />` with `persistenceKey={null}` so each visit starts fresh.
    - Seed the shapes (sticky note + two arrows) via `editor.createShapes(...)` after mount in a `useEffect` keyed on the mount.
    - "Reset" button: clears all shapes and re-creates the seed.
    - **Don't** use the Yjs store from `lib/drawing/yjs-store.ts` — single-user sandbox doesn't need persistence.
- **Verify:**
  - Bundle size check: open the app's network tab on `/`. The hero is interactive within ~1s on a 3G throttle; the sandbox section's chunk loads only when scrolling into view.
  - Type in the markdown side → preview updates. Drag a shape on the drawing side → it sticks.
  - Reset button works on both.
  - JS-disabled fallback: add a `<noscript>` element to `apps/web/index.html` directly (outside the React tree). SPA-rendered noscript blocks don't appear in the initial HTML. Content: a simple "Rumi requires JavaScript to run. Please enable it to continue." message styled to match the rest of the page.

## Phase 4: Cookie consent

**Gate:** First-visit users see the banner; preferences persist; analytics gating works.

### Task 12: Cookie banner + preferences modal

- **What:** Bottom-right banner with three buttons; "Manage preferences" opens a modal with three toggles.
- **Why:** GDPR-safe from day one; analytics depends on the consent value.
- **How:**
  - State:
    ```ts
    type Consent = { necessary: true; analytics: boolean; marketing: boolean; timestamp: number };
    const KEY = "rumi_cookie_consent";
    function getConsent(): Consent | null {
      try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
    }
    function setConsent(c: Consent) { localStorage.setItem(KEY, JSON.stringify(c)); }
    ```
  - Banner shows when `getConsent() === null`. Buttons:
    - "Accept all" → `setConsent({ necessary: true, analytics: true, marketing: true, timestamp: Date.now() })`
    - "Accept necessary" → `setConsent({ necessary: true, analytics: false, marketing: false, ... })`
    - "Manage preferences" → opens modal
  - Modal shows three toggles. Necessary is locked on (visually disabled). Submit saves the new consent.
  - Footer "Cookie preferences" link re-opens the modal regardless of current state.
  - On consent change, dispatch a window event (`window.dispatchEvent(new Event("rumi-consent-changed"))`) — the analytics loader (Task 13) listens for this.
- **Verify:** Hard reload sees the banner; clicking "Accept necessary" hides it; reload again — banner stays hidden; clicking footer "Cookie preferences" opens the modal.

### Task 13: Plausible analytics integration (consent-gated)

- **What:** Lazy-load Plausible's tracking script only when `analytics: true`.
- **Why:** Privacy-respecting, consent-gated, no PII.
- **How:**
  - Add an env var `VITE_PLAUSIBLE_DOMAIN` (already follows the `VITE_*` pattern in `apps/web/src/lib/env.ts`). When unset, the loader is a no-op.
  - Create `apps/web/src/lib/analytics.ts`:
    ```ts
    let scriptEl: HTMLScriptElement | null = null;

    export function maybeLoadAnalytics() {
      const consent = JSON.parse(localStorage.getItem("rumi_cookie_consent") ?? "null");
      const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
      if (!consent?.analytics || !domain) {
        unloadAnalytics();
        return;
      }
      if (scriptEl) return;
      scriptEl = document.createElement("script");
      scriptEl.defer = true;
      scriptEl.dataset.domain = domain;
      scriptEl.src = "https://plausible.io/js/script.js";
      document.head.appendChild(scriptEl);
    }

    function unloadAnalytics() {
      if (scriptEl) {
        scriptEl.remove();
        scriptEl = null;
      }
    }

    // Tiny event helper so call sites are typed.
    export function trackEvent(name: string, props?: Record<string, string>) {
      // biome-ignore lint/suspicious/noExplicitAny: Plausible global
      const plausible = (window as any).plausible;
      if (typeof plausible === "function") plausible(name, { props });
    }
    ```
  - Mount in `landing-page.tsx`:
    ```ts
    useEffect(() => {
      maybeLoadAnalytics();
      const handler = () => maybeLoadAnalytics();
      window.addEventListener("rumi-consent-changed", handler);
      return () => window.removeEventListener("rumi-consent-changed", handler);
    }, []);
    ```
  - Tracked events:
    - "Sign in click" — fires on landing nav and hero CTAs
    - "Upgrade click" with `{ tier: "pro" | "max" }` — fires on pricing card CTAs
    - "Start for free click" — fires on hero primary CTA
  - Page views: Plausible's script tracks them automatically.
- **Verify:** With consent off, no `plausible.io` request fires. With consent on, the script loads and `trackEvent` calls work.

## Phase 5: SEO + performance polish

**Gate:** Lighthouse-style basics pass; OG previews look right.

### Task 14: SEO meta tags

- **What:** Title, description, canonical, OpenGraph tags on the landing route.
- **Why:** Cheap to do right.
- **How:**
  - Use a `useEffect` in `LandingPage` that sets `document.title` and inserts/updates `<meta>` tags via `document.head.appendChild`. The TanStack Router `head` config API has been unstable across versions; the imperative DOM approach is robust and easy to clean up.
  - Tags:
    - `<title>Rumi — Real-time collaboration for developers</title>`
    - `<meta name="description" content="Markdown, code, and drawings in shared rooms. No setup, no merge conflicts." />`
    - `<link rel="canonical" href="https://rumi.app/" />`
    - OG: `og:title`, `og:description`, `og:image` (point at `/og-cover.png` — add a static asset to `apps/web/public/`), `og:type=website`, `og:url`
    - Twitter card: `twitter:card=summary_large_image`
  - The static OG image should be added to `apps/web/public/og-cover.png` (1200x630). Use a hand-crafted screenshot for now.
- **Verify:** `curl https://rumi.app/ | grep -E 'og:|twitter:'` shows the tags. View source on the deployed page.

### Task 15: Performance verification

- **What:** Confirm the landing chunk is small; sandbox is lazy.
- **Why:** Landing should be fast even on slow connections.
- **How:**
  - Run `bun run --cwd apps/web build`. Inspect `dist/assets/`. Chunks include:
    - `index-*.js` — the entry chunk; landing components should be in here OR a small per-route chunk
    - Sandbox should have its own chunk(s) — confirmed by lazy import. Verify CodeMirror + tldraw are NOT in the entry chunk.
  - Preload Lato in `index.html` to avoid FOIT.
- **Verify:** Open DevTools → Network → throttle to "Slow 3G" → reload `/`. Hero is paintable in < 2s. Sandbox loads when scrolled into view.

## Phase 6: Pre-commit gate

`bun run check` → `bun run typecheck` → `bun test apps packages` → `vite build`. All must pass.

## Edge cases (call-outs from the design doc)

- **Authenticated visitor on `/`** — handled by `beforeLoad` in `routes/index.tsx` (Task 1).
- **Logged-out user clicks "Upgrade Pro"** — sign-in flow's `next` is `/upgrade?plan=pro`. After OAuth, `/upgrade` (per billing-plan Task 11) reads `?plan=` and pre-selects that card.
- **Cookie consent for authenticated user** — **Mount the cookie banner + modal at `__root.tsx`** (not just `landing-page.tsx`). The footer's "Cookie preferences" link must work on `/privacy` and `/terms` too, which are public routes (per misc-deferred Feature 1). Mounting at the root means the banner shows once across the entire app on first visit; the modal can be reopened from any footer.
  - Implementation note: the banner's "show on first visit" logic stays the same (check `localStorage.rumi_cookie_consent`). The MODAL is the part that needs to be reachable from every footer link — mounting at root fixes this without coupling each route to the modal.
  - Adjust Task 9 (compose `landing-page.tsx`) and Task 12 (cookie banner) to mount the components in `__root.tsx`'s tree, not the landing route.
- **JS disabled** — static content (hero, features, pricing, footer) renders. Sandbox shows "JavaScript required to try the editor" placeholder.
- **Sandbox bundle slow** — skeleton inside the section while chunks resolve. If > 5s, render a static screenshot fallback (defer the screenshot work — start with the skeleton; add fallback only if real users hit slow loads).
- **OG image regeneration** — static asset for now.

## Out of scope (deferred per design doc)

- Localization / i18n
- A/B testing infrastructure
- Blog or docs section
- Auth-walled landing experiments
- In-page sign-up form
- Newsletter capture
- Customer logos / testimonials
- Looping video / GIF demos (sandbox is the demo)

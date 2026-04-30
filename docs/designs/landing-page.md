# Landing Page

## Context

Currently `/` redirects to sign-in if unauthenticated and to the dashboard if authenticated. There's no public marketing surface — the only thing a non-logged-in visitor sees is the OAuth-only sign-in screen. This is fine while Rumi is closed, but ships nothing for prospective users to evaluate, and the pricing CTA from settings has nowhere to point.

The landing page is sequenced after billing (item 3 in `docs/TODO.md`) so the pricing section's "Upgrade" buttons hit a working Checkout flow. Pricing-tier numbers come from `docs/designs/pricing-tiers.md`.

## Goals

- Public landing page at `/` for unauthenticated visitors
- Authenticated visitors at `/` continue to the dashboard (no behavior change for logged-in users)
- Pricing section that mirrors the tier table in `pricing-tiers.md` and CTAs into Stripe Checkout
- Live demo or video that shows real-time collaboration without requiring sign-in
- Cookie consent banner (GDPR/ePrivacy compliant)
- Footer links to Privacy Policy, Terms of Service (see `misc-deferred.md`), and GitHub
- Sign-in CTA in the nav and a primary "Start for free" CTA in the hero

## Non-Goals

- Localization / i18n in MVP (English only)
- A/B testing infrastructure
- Blog or docs section (defer until there's content)
- Auth-walled landing experiments (e.g. "show different copy after sign-in")
- Analytics integration is consent-gated but vendor choice is open (see Open Questions)

## Design

### Routing

`/` becomes a public route. The `_authed.tsx` guard moves down — only `/_authed/*` routes are guarded. The root redirects authenticated users to `/_authed/` (current dashboard), unauthenticated users see the landing page.

Implementation: split `routes/__root.tsx` so `/` is a standalone landing route. The current dashboard becomes `/_authed/` (already is, just confirm the redirect).

```ts
// routes/index.tsx (new public route)
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (context.session?.user) throw redirect({ to: '/_authed/' });
  },
  component: LandingPage,
});
```

### Sections

Vertical scroll, single page, ~6 sections.

**1. Nav (sticky)**

- Left: Rumi logo (logo-T mark + wordmark)
- Center (desktop only): "Pricing", "GitHub" links — anchor scroll to `#pricing`, external to repo
- Right: "Sign in" button → `/sign-in`

Collapses to a hamburger on mobile.

**2. Hero**

- Tagline with **word-swap**: "Real-time collaboration for `[technical | research | team]` documentation" — a single word in the headline cycles every 2.5s
- Subhead: one sentence on what Rumi is — "Markdown, code, and drawings in shared rooms. No setup, no merge conflicts."
- Primary CTA: "Start for free" → `/sign-in?next=/_authed/`
- Secondary CTA: "Try it" → smooth-scrolls to the sandbox section
- Subtle: "No credit card required"

The word-swap is implemented as a CSS-only crossfade between absolute-positioned `<span>` elements, or a tiny React component using `setInterval`. It pauses on first user interaction (scroll, click, keypress) so it doesn't distract during reading. Keep the cycled words to 2–3 max so the headline width stays stable; reserve fixed width with the longest word to avoid layout shift.

**3. Interactive sandbox**

The high-impact section on the page. A no-server, no-auth in-page playground that lets visitors *touch* the editor surfaces:

- A small two-pane mock room rendered inline on the landing page
- **Left pane:** a CodeMirror 6 instance bound to a local `Y.Text` (no Hocuspocus, no server). Pre-seeded with the markdown shown below; users can type and the markdown preview updates live
- **Right pane:** a tldraw canvas in its lightest configuration, pre-seeded with the shapes shown below; the user can drag, resize, draw, or add new shapes
- A small "Reset" button that re-seeds both panes
- **Read the sandbox demo as: "this is what editing in Rumi feels like."** It doesn't show real-time collaboration (no cursors from other users), but it shows the actual editor + drawing surfaces are real and immediate
- A small banner above the sandbox: *"This is a single-user preview. Sign up to collaborate in real time."*

**Markdown seed (left pane):**

````markdown
# Welcome to Rumi

Real-time collaboration for developers. Try editing this text — the preview updates as you type.

```ts
function greet(name: string) {
  return `Hello, ${name}!`;
}
```

## What you can do here

- [x] Type markdown
- [x] Draw on the canvas
- [ ] Sign up to collaborate in real time
````

**tldraw seed (right pane):**

- One sticky note shape, centered, text: *"Try drawing here"*
- Two arrow shapes pointing inward at the sticky note from opposite sides

The sandbox is a **completely separate code path** from the editor in `/_authed/r/:slug` — it imports CodeMirror and tldraw directly with no Hocuspocus, no Yjs sync, no awareness wiring. Bundled into a lazy-loaded chunk so it doesn't block the hero render.

Why a sandbox over a video: visitors who type feel ownership. Static videos are lower-information; an interactive surface lets a developer evaluate the editor quality (font, line-height, shortcut feel) directly. The trade-off — it doesn't show collaboration — is mitigated by the banner above.

**4. Features grid**

3–4 cards, two rows on desktop:

- Real-time sync — "See edits as they happen. Conflict-free CRDT under the hood."
- Markdown + code tabs — "Mix prose, code, and drawings in one room. ~150 languages."
- Drawing boards — "Whiteboard-grade collaborative canvas powered by tldraw."
- Guest access — "Share a link; no signup required for read-only viewers."

Each card: small icon + headline + one-sentence description. No marketing fluff.

**5. Pricing**

Three-column card layout — Free / Pro / Max. Same visual structure as the Billing tab (`docs/designs/settings-redesign.md`) but slightly larger. Above the cards: monthly/yearly toggle (yearly shows "save 17%").

Card content per tier:
- Plan name + tagline ("For trying it out" / "For solo developers" / "For power users")
- Price + interval
- 4–5 bullets pulling from the limits table
- CTA — "Get started" (Free → `/sign-in`), "Upgrade" (Pro/Max → `/sign-in?next=/_authed/settings?tab=billing&plan=pro`)

Below the cards: the full feature comparison table from `pricing-tiers.md`.

The Pro/Max upgrade CTAs route through sign-in if the user isn't logged in, then land on the billing tab with the plan pre-selected. This needs the settings page to read `?plan=` and pre-trigger the checkout flow — minor addition.

**6. Footer**

- Left: Rumi logo + tagline + © 2026
- Center columns:
  - Product: Pricing, Sign in
  - Legal: Privacy, Terms, Cookie preferences (re-opens the modal)
  - Company: GitHub, Status (placeholder)
- Right (or below on mobile): social icons (GitHub only at MVP)

### Cookie consent

Required if we want to add analytics (Posthog, Plausible, GA4, etc.). Even without analytics, having the modal in place from day one avoids retrofitting later.

**Banner** (shown on first visit, position: bottom-right, dismissible only via the buttons):

> "We use cookies to ensure essential functionality, enhance your experience, and analyze traffic."
>
> [Accept all] [Accept necessary] [Manage preferences]

**"Manage preferences" modal:**

| Category | Toggle | Default |
|---|---|---|
| Necessary | Locked on | On |
| Analytics | User-configurable | Off |
| Marketing | User-configurable | Off |

**Storage:** `localStorage.rumi_cookie_consent = JSON.stringify({ necessary: true, analytics: bool, marketing: bool, timestamp: number })`.

**Behavior:**
- On every page load, check `rumi_cookie_consent`. If absent, show the banner.
- Analytics tooling only loads if `analytics: true` (lazy-load the analytics module, gated on the consent value).
- "Cookie preferences" footer link re-opens the modal; user can downgrade and we tear down the analytics scripts on the next reload.

### Animations / motion

Light. Hero copy fades in on load. Section headings get a subtle slide-up on scroll-into-view via Intersection Observer + a simple Tailwind transition. No heavy libraries (no Framer Motion in MVP — adds bundle weight).

The word-swap (described in the hero section) is the only "always-on" animation. Everything else is one-shot scroll-triggered.

### Performance

- Landing page is its own route — must not eagerly pull in CodeMirror, Yjs, tldraw, Hocuspocus, or anything from the editor surface
- The sandbox section imports CodeMirror and tldraw, but those are **lazy-loaded** via dynamic `import()` triggered on Intersection Observer (when the sandbox enters the viewport) so the hero, features, and pricing sections render fast
- Vite code-splitting handles this if we don't accidentally import shared components from the editor route
- Show a lightweight skeleton inside the sandbox shell until the chunks resolve — the user sees the section structure even while the bundle loads
- Preload the hero font (Lato) to avoid FOIT
- Sandbox bundle target: under 400KB gzipped (CodeMirror is ~150KB, tldraw is the heavyweight at ~470KB raw / ~140KB gzipped — verify against the existing room route's bundle)

### Analytics

**Plausible** (`https://plausible.io`) — privacy-respecting, cookie-less by default, simple event tracking, ~$9/mo for our scale.

- Loaded only when `localStorage.rumi_cookie_consent.analytics === true`
- Plausible's default tracking is cookie-less and GDPR-friendly even without consent, but we gate behind explicit consent for safety / consistency with the cookie banner
- Tracked events at MVP: page views, "Sign in" clicks, "Upgrade" clicks per tier, "Start for free" clicks
- No PII; no session replay; no cross-site tracking

### SEO basics

- `<title>`: "Rumi — Real-time collaboration for developers"
- `<meta name="description">`: 155-char summary
- Open Graph tags for link previews (og:image is a static Rumi cover screenshot)
- `<link rel="canonical" href="https://rumi.app/">`

A small thing but cheap to do right.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Route | `/` is public; `/_authed/*` is gated | Zero behavior change for logged-in users; clean separation |
| High-impact section | Interactive in-page sandbox (CodeMirror + tldraw, no server) | Visitors *feel* the editor instead of watching a passive video; reuses production components without server load |
| Sandbox loading | Lazy-loaded via dynamic `import()` on Intersection Observer | Hero/features/pricing render fast; heavy editor bundles only load when the user scrolls to the sandbox |
| Pricing toggle | Monthly/Yearly with 17% yearly discount | Mirrors competitor norms; matches Stripe configuration |
| Word-swap headline | Ship from day one, CSS-driven crossfade | Adds personality; pauses on first user interaction so it doesn't distract |
| Cookie consent | Real banner with three options + manage modal | GDPR-safe from day one; cheaper now than retrofitting |
| Analytics vendor | Plausible | Privacy-respecting, cookie-less by default, simple, fits developer audience |
| Status page link | Defer until a real status page exists | Adding a dead link is worse than no link |
| Animation library | None (Tailwind transitions + a few CSS keyframes) | Bundle hygiene; landing should be fast |
| Footer | Lightweight, no oversized newsletter blocks | Matches developer-tool aesthetic (Linear, Vercel) |

## Rejected Alternatives

- **Standalone marketing site** (separate Astro/Next project) — overkill at MVP; one Vite SPA route works
- **Auto-detect timezone for currency** — out of scope; charge USD only via Stripe (Stripe Tax handles regional VAT)
- **In-page sign-up form** — sign-up is OAuth-only; the landing CTA hands off to the existing `/sign-in` page
- **Newsletter capture** — no newsletter to send yet; defer
- **Customer logos / testimonials** — no real customers yet; faking them is worse than omitting them
- **Looping video / GIF as the demo** — lower-information than the sandbox; passive viewing doesn't sell editor quality the way typing into one does
- **Embedded read-only live room** with autoplay scripted cursors — too many moving parts (server load, demo content drift, autoplay reliability); revisit only if the sandbox underperforms
- **Posthog or GA4 for analytics** — Posthog is heavier than we need (no session replay use case yet); GA4 is invasive and unfriendly to developer audiences

## Edge Cases & Constraints

- **Authenticated user lands on `/`** — redirect to dashboard. Don't render the landing page even briefly.
- **User clicks "Upgrade Pro" while logged out** — sign-in flow includes `next=/_authed/settings?tab=billing&plan=pro`. After OAuth callback, the settings page reads `?plan=` and either pre-opens the checkout flow or just preselects the card. Recommendation: just preselect; don't auto-redirect to Stripe (gives the user a chance to confirm).
- **Cookie consent on a logged-in user** — show the banner once even for authenticated users; their consent persists in `localStorage` per browser.
- **Mobile layout** — hero stacks, demo video plays at viewport width, pricing cards stack vertically. Compact single-column nav with hamburger.
- **No JavaScript** — at minimum, the static content (hero, features, pricing, footer) should render. Cookie banner and the interactive sandbox are JS-required, which is fine because consent and the editor surfaces are JS concepts. The sandbox section should show a "JavaScript required to try the editor" placeholder if JS is disabled, not a broken empty box.
- **Sandbox bundle slow to load** — show a skeleton inside the sandbox shell until the lazy chunks resolve. If loading takes > 5s, render a static screenshot fallback ("Couldn't load the live preview — see screenshots below") so the section is never empty.
- **"Manage preferences" while analytics are loaded** — toggling analytics off should attempt to remove the analytics script, but at minimum stop new events from firing. Easiest: gate the loader so subsequent page loads honor the new setting; hard-reload after toggle to be safe.
- **OG image regeneration** — static asset for now; revisit when we want per-room or dynamic OGs.

## Open Questions

None — all resolved.

## Implementation notes

- **Pricing in non-USD currencies** is out of scope for landing. Stripe Checkout handles display currency based on the user's locale; landing-page prices stay USD.

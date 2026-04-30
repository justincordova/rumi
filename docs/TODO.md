# Rumi — Product Roadmap & TODO

Ordered by dependency and business impact. Each item links to the design doc
or plan that should be written before implementation starts (per the
brainstorm → plan → execute workflow).

---

## 1. Settings Page ✅

**Why first:** Prerequisite for exposing plan/billing UI to logged-in users.
Currently user preferences (theme, fonts) are accessible only via a small
topbar dropdown. A proper `/settings` route is needed before billing can
surface plan status, usage, and upgrade CTAs.

**Scope:**
- `/settings` route (TanStack Router, behind `_authed`)
- Sub-sections: Appearance (theme, UI font, editor font), Account (OAuth
  provider info, sign out), Plan & Billing (current tier, usage, upgrade CTA)
- Appearance section reads/writes the existing `usePrefs()` Zustand store
- Account section is read-only (Supabase profile data)
- Plan & Billing section is a stub until Stripe is wired up (shows "Free"
  with locked upgrade button)

**Design doc:** `docs/designs/settings.md`

---

## 2. Pricing Tiers — Define & Enforce ✅

**Why second:** Defines the limits that everything downstream (Stripe,
landing page, settings) references. Must be locked before building billing.

### Proposed tier structure

| | Free | Pro | Team |
|---|---|---|---|
| Price | $0 | ~$8/mo | ~$20/mo |
| Rooms | 3 | Unlimited | Unlimited |
| Tabs per room | 3 | 10 | 10 |
| Connections per room | 5 concurrent | 15 concurrent | 50 concurrent |
| Guest access | Yes (`view` only) | Yes (`view` + `edit`) | Yes (`view` + `edit`) |
| AI generation | — | — | Future: included credits |
| Support | Community | Email | Priority |

> These numbers are starting points — validate against comp analysis (HackMD,
> Notion, tldraw Cloud) before locking. The tab cap of 3 is already enforced
> in the DB; rooms and connections need new enforcement.

### Enforcement changes needed

- `rooms` table: enforce per-user room count at `POST /api/rooms` (check
  owner's existing room count against their plan limit)
- `hocuspocus.ts`: enforce max concurrent connections per room in
  `onAuthenticate` (count active connections for that room's documents,
  reject if over limit with a typed stateless error)
- `tabs` table: the 3-tab cap is already enforced; Pro/Team cap (10) needs
  a plan-aware check
- Plan lookup: a thin `getUserPlan(userId)` helper (DB or Stripe entitlement
  check) consumed by all enforcement points

**Design doc:** `docs/designs/pricing-tiers.md`

---

## 3. Stripe Integration & Billing

**Why third:** Requires the tier definitions above and the settings page
shell to exist first.

**Scope:**
- Stripe Checkout for plan upgrades (hosted checkout, not embedded)
- Stripe Customer Portal for subscription management (cancel, change plan,
  update payment method) — avoids building a billing UI from scratch
- Webhook handler (`POST /api/billing/webhook`) for `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`
- `user_subscriptions` table (or equivalent): `user_id`, `stripe_customer_id`,
  `stripe_subscription_id`, `plan` (`free|pro|team`), `status`, `current_period_end`
- `getUserPlan()` helper reads this table (falls back to `free` if no row)
- Settings → Plan & Billing section becomes functional: shows current plan,
  usage meters (rooms used / limit, etc.), upgrade/manage buttons

**Open question:** Billing is per-user (individual plans) or per-workspace
(team plans billed to the owner)? Recommendation: start with per-user billing
for Pro; add workspace-level billing for Team in a later iteration.

**Design doc:** `docs/designs/billing.md`

---

## 4. Landing Page

**Why fourth:** Needs the pricing tier table to be finalized so it can be
displayed accurately. Sequenced after billing so the CTA actually works end
to end.

**Scope:**

### Route change (prerequisite)
Currently `/` redirects to sign-in if unauthenticated and to the dashboard
if authenticated. Split this: unauthenticated visitors see the landing page;
authenticated users see the dashboard. The landing page is a new standalone
route, not behind `_authed`.

### Sections
1. **Nav** — Logo left; "Pricing", "About" (or "Docs") links center;
   "Sign in" button top-right (GitHub OAuth, same as sign-in page)
2. **Hero** — Large headline with animated word-swap in the subhead
   (e.g., "Real-time collaboration for `technical` / `research` / `team`
   documentation"). Primary CTA: "Start for free — no credit card".
   Secondary CTA: "See it live" → scrolls to demo section.
3. **Live demo** — Embedded read-only room (or a looping video/GIF) showing
   a real Rumi room with two cursors collaborating on a markdown tab and a
   drawing tab side by side. This is the single highest-impact conversion
   element for a collab tool.
4. **Features grid** — 3–4 cards: Real-time sync, Markdown + code tabs,
   Drawing boards, Guest access (view without sign-in). Short headline +
   one sentence each.
5. **Pricing section** — Three-column card layout (Free / Pro / Team) with
   the tier table from item 2 above. Toggle for monthly/annual billing.
   "Get started" / "Upgrade" CTAs.
6. **Footer** — Links: GitHub, Privacy Policy, Terms of Service, Cookie
   Preferences (re-opens cookie consent modal).

### Cookie consent banner
- Shown on first visit (before any analytics/tracking loads)
- Copy: "We use cookies to improve your experience. We use cookies to ensure
  essential site functionality, enhance your experience, and analyze traffic."
- Three actions: **Accept all** / **Accept necessary** / **Manage preferences**
- Manage preferences opens a modal with toggles: Necessary (locked on),
  Analytics, Marketing
- Consent stored in `localStorage` (`rumi_cookie_consent`); re-checked on
  each page load
- Required for GDPR/ePrivacy compliance if targeting EU users

### Design references
- HackMD.io — hero copy pattern, animated word-swap
- tldraw.com — live demo embed approach
- Linear.app — clean feature grid

**Design doc:** `docs/designs/landing-page.md`

---

## 5. AI Generation (Future)

**Why last:** Requires billing (AI credits = paid feature), stable tab types
(something to generate into), and likely a separate LLM provider integration.
Placeholder for now — flesh out when tiers are live and you have revenue to
fund API costs.

**Ideas to explore:**
- "Generate" button in the markdown toolbar → prompt → inserts generated text
  into the Y.Text at cursor (all collaborators see the insert in real time)
- "Generate drawing" from a text prompt → inserts tldraw shapes
- AI-assisted code completion in code tabs (lower priority; CodeMirror has
  extension hooks for this)
- Team tier includes a monthly credit pool; Pro tier has a smaller pool or
  per-use pricing

**Design doc:** `docs/designs/ai-generation.md` (write when ready)

---

## Sequencing summary

```
Settings page
    ↓
Pricing tiers defined + enforced
    ↓
Stripe billing wired
    ↓
Landing page (pricing section now accurate, CTA works end-to-end)
    ↓
AI generation (future, requires billing)
```

---

## Other items (no strict ordering)

- **Notifications** — the bell icon in the topbar is currently a stub.
  Scope: an in-app notification feed for invite and membership events only
  (not real-time edit events — that's what the live editor is for).
  Three event types:
  - *Invite received* — "Justin invited you to wispy-falcon-42". Shown in the
    bell feed on the dashboard. Clicking it accepts the invite and navigates
    to the room. Fills a real gap: invitees currently have no way to discover
    pending invites without knowing the slug.
  - *Invite accepted* — "Alex accepted your invite to wispy-falcon-42".
    Shown to the room owner so they know their collaborator joined.
  - *New member joined via link* — "Someone joined wispy-falcon-42". Shown
    to the owner of an open room when a new member auto-joins. Consider a
    per-room toggle to suppress this for high-traffic rooms.
  Requires: a `notifications` DB table (`id`, `user_id`, `type`, `payload`
  jsonb, `read_at`, `created_at`); write path triggered from invite
  acceptance and auto-join code; `GET /api/notifications` endpoint; bell
  popover component in the topbar. Should be designed together with email
  invites below — they share the same trigger points.
  **Design doc:** `docs/designs/notifications.md`

- **Privacy Policy + Terms of Service pages** — needed before the landing
  page ships publicly; can be simple static routes with boilerplate legal
  copy (consult a lawyer or use a generator like Termly/Iubenda)
- **Email invites** — currently invites are sent as a copied link only;
  adding email delivery (SES/Resend) means the invitee gets an email with
  an accept link even if they're not on the dashboard. Design together with
  notifications — same trigger points (invite created, invite accepted)
- **Cursor presence in editor** — deferred per SPEC.md; revisit after launch
- **Drag-to-reorder tabs** — deferred per SPEC.md
- **Member management** — kick member, leave room, owner transfer; post-MVP
- **Room restore endpoint** — soft-delete only for now; restore is manual
- **Horizontal scaling** — Redis pub/sub + Hocuspocus Redis extension when
  single-instance becomes a bottleneck
- **Mobile polish** — phone is best-effort today; a dedicated mobile pass
  post-launch
- **Export** — download tab content as `.md` / `.txt`; download drawing as
  PNG/SVG (tldraw supports this natively). Gate behind Pro and Max tiers
  after implemented.

---

## Future monetization levers

Not in current scope. Evaluate after billing is live.

- **File upload size limits** — Free tier gets a small upload cap (e.g. 1MB per
  image), Pro/Max get larger (e.g. 20MB). Relevant when Rumi supports image
  embeds in markdown tabs. Gate behind Pro+.
- **Version history** — Full tab version history with diff/restore. Would
  require a `tab_versions` table. Notion and HackMD gate this behind paid.
  Gate behind Pro+.
- **Custom branding** — Remove Rumi branding from shared/public room pages.
  Notion gates "remove branding" behind paid. Gate behind Max.
- **AI generation** — Credits-based AI features (generate text, generate
  drawings, code completion). Per the TODO item 5 above. Pro gets a monthly
  credit pool, Max gets a larger pool, Free gets none.

---

## Handoff: Settings Page & Pricing Tiers

Items 1 (Settings Page) and 2 (Pricing Tiers) are implemented. Here's what's
next for anyone picking up item 3 (Stripe billing) or item 4 (Landing page):

- `getUserPlan(userId)` in `apps/server/src/rooms/plan.ts` returns plan limits.
  The core logic is in `resolvePlan(row)` — a pure function that's easy to test.
- Concurrent user limit is enforced by counting unique users across all
  Hocuspocus documents for the room. Only runs on control doc connections
  (`room:<roomId>`) to avoid double-counting. See
  `apps/server/src/sync/connection-limits.ts`.
- Rooms-open limit (10, all tiers) enforced the same way.
- The `subscriptions` table has `stripe_*` columns ready for Stripe integration.
- Settings page reads from `GET /api/subscriptions/me`.
- The tier structure is Free / Pro / Max (not Team). See
  `docs/designs/pricing-tiers.md` for the full breakdown.
- Next items on the roadmap: Stripe billing (item 3), Landing page (item 4).

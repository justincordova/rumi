# Pre-Launch Hardening

## Context

A pre-launch audit (cross-checked between GLM-5.1 and Opus 4.7) surfaced ~30
issues spanning data-integrity bugs, missing infrastructure, broken UI promises,
and polish gaps. This doc consolidates the verified findings into a single
hardening pass so Rumi can ship to production without leaving silent bugs,
fake features, or legal exposure on the table.

Scope is intentionally bug-fix and gap-fill heavy — no new product surfaces
beyond what the existing UI already promises. Two items from the original
list (room restore/trash UI, tab-reorder Y.Array element ordering) were
dropped after verification: trash UI already ships, and the Y.Array element
order is by-design with the client correctly sorting by ordinal.

A misleading pricing-table entry ("File uploads (20MB/50MB)") is being
removed entirely rather than implemented; tldraw's built-in image-paste
behavior (base64-embedded into `TLAsset` records, synced via the existing
Yjs binding) covers the only legitimate "upload" use case in the product
today, so no backend storage work is needed for launch. Export takes
its place as the Pro/Max-anchor feature.

## Goals

- Close every Critical and High data-integrity bug before any production traffic
- Eliminate UI elements that don't do what they appear to do (Coming Soon stubs,
  fake pricing rows, misnamed fields)
- Add the legal pages and observability needed to operate a paid SaaS
- Get the product to a "ship-able" state without expanding scope

## Non-Goals

- Hosting / deployment / CI-to-prod runbooks (operational, separate effort)
- AI features (separate brainstorm — see TODO.md)
- Horizontal scaling (already deferred in TODO.md)
- Full mobile redesign (phone remains "best-effort" per SPEC.md; only obvious
  overflow bugs get fixed)
- Full accessibility audit (a quick pass on the worst offenders only)
- File upload infrastructure of any kind — pricing row is being removed,
  tldraw default behavior stays as-is

## Design

The work is grouped into six sections, ordered roughly by risk. Each item
has a short description, the verified evidence behind it, and acceptance
criteria. The implementation order is suggested at the bottom.

---

### §1. Critical data-integrity bugs

#### 1.1 `room_members` has no primary key

**Evidence.** `apps/server/src/db/schema.ts:32-41` declares no PK or unique
constraint on `(room_id, user_id)`. Migration 0000 created the table without
one, and no later migration adds it. Five `onConflictDoNothing()` callsites
(`rooms/service.ts:196,213,624`, `sync/authorize.ts:63,76`) are silent no-ops
because Postgres has no constraint to detect a conflict against. Concurrent
auto-joins on WebSocket reconnect can create duplicate rows.

**Fix.** Migration adds `PRIMARY KEY (room_id, user_id)`. Migration must
also de-duplicate any existing duplicate rows, keeping the row with the
highest-precedence role (`owner > admin > member`) and the earliest
`joined_at` for tiebreak.

**Acceptance.**
- Migration succeeds against a DB seeded with duplicate `room_members` rows
- After migration, attempting to insert a duplicate raises a constraint violation
- All `onConflictDoNothing()` callsites continue to work (now actually atomic)

#### 1.2 `resolvePlan` cancels paid access immediately

**Evidence.** `apps/server/src/rooms/plan.ts:33-44`:
```ts
const isActive = row.status === "active" || row.status === "past_due";
const canceledButValid = row.cancelAtPeriodEnd && periodValid;
if (isActive && (inTrial || periodValid || canceledButValid)) { ... }
```
When `customer.subscription.deleted` fires, the webhook sets
`status='canceled'`. `isActive` becomes `false`, the entire `if`
short-circuits, and the user drops to free immediately — contradicting the
documented behavior in AGENTS.md ("preserves access until period end").

**Fix.** Restructure the conditional so canceled-but-period-valid stays
on its paid plan:
```ts
const stillEntitled = (isActive && (inTrial || periodValid)) || canceledButValid;
if (stillEntitled) { ...return paid plan }
```
Where `canceledButValid` is broadened to `row.status === "canceled" && periodValid`
(remove the `cancelAtPeriodEnd` check — once `status='canceled'` we know
intent is to end at period_end).

**Acceptance.**
- Test: `status='canceled'`, `currentPeriodEnd > now` returns `plan='pro'`
- Test: `status='canceled'`, `currentPeriodEnd < now` returns `plan='free'`
- Test: `status='active'`, `cancelAtPeriodEnd=true`, `currentPeriodEnd > now`
  returns `plan='pro'` (existing behavior preserved)

#### 1.3 Whitelist/blacklist operations not atomic

**Evidence.** `apps/server/src/rooms/service.ts:303-389` (`addToWhitelist`)
performs 5 statements outside any transaction, including a delete from
blacklist before inserting into whitelist. `service.ts:426-499`
(`addToBlacklist`) is worse: deletes from whitelist, loops kicking all
matching members, then inserts into blacklist — six statements, no `tx`.
A crash mid-flow leaves the user in an inconsistent state.

**Fix.** Wrap both functions in `db.transaction(async (tx) => { ... })`.
Replace `db.*` calls inside with `tx.*`. The auto-kick loop in
`addToBlacklist` must be inside the same tx as the blacklist insert.

**Acceptance.**
- Existing tests still pass
- New test: simulated failure mid-flow leaves DB unchanged (use a tx that
  throws before commit)
- Concurrent `addToWhitelist` + `addToBlacklist` for the same email never
  produce a row on both lists

#### 1.4 Notification prefs frontend mismatch + DB column rename

**Evidence.** Three different names for the same field:
- DB column: `invite_received_email` (`schema.ts:145`)
- Protocol field: `accessGrantedEmail` (`packages/protocol/src/notifications.ts:68`)
- Frontend interface + PATCH body: `inviteReceivedEmail`
  (`apps/web/src/routes/_authed/settings.tsx:145,232`)

The service layer translates between DB and protocol, but the frontend
sends the wrong wire field. Toggle saves are silently ignored.

**Fix.** Three coordinated changes:
1. **Migration**: `ALTER TABLE notification_preferences RENAME COLUMN invite_received_email TO access_granted_email`
2. **Schema + service**: rename the Drizzle column, drop the manual
   mapping shim in `notifications/service.ts:80-103`
3. **Frontend**: rename `inviteReceivedEmail` → `accessGrantedEmail` in
   `settings.tsx`

After this change there is one name end-to-end.

**Acceptance.**
- Toggling "Email me when I'm given access" persists across reloads
- No service-layer mapping code remains (`accessGrantedEmail` flows through
  unchanged)
- Existing rows survive the rename (preserve values)

---

### §2. Database hardening (single migration)

All §1 schema changes plus index additions ship in **one migration file**
to keep the migration count down. File:
`apps/server/src/db/migrations/000X_pre_launch_hardening.sql`.

Indexes to add:
- `room_members(user_id)` — every "list my rooms" query filters on this; no
  index means full sequential scan
- `rooms(owner_id)` — owner-scoped queries are unindexed
- `subscriptions(stripe_customer_id)` — every Stripe webhook does
  `WHERE stripe_customer_id = ?`; no index = sequential scan on every event

Indexes intentionally NOT added:
- `tabs(room_id)` — already covered by the leading column of the existing
  `(room_id, ordinal)` UNIQUE INDEX. Postgres uses leading-column lookups
  natively.

**Acceptance.**
- Migration applies cleanly to a populated DB
- `EXPLAIN ANALYZE` for the three queries above shows index usage post-migration
- Schema file (`db/schema.ts`) declares the indexes inline so Drizzle
  introspection stays in sync

---

### §3. Pre-launch blockers

#### 3.1 Privacy Policy + Terms of Service

**Status.** Not implemented. Footer (`landing-footer.tsx:21-32`) has
dead `<a href="/privacy">` / `/terms` links. Cookie consent banner
(`cookie-consent.tsx:55-58`) doesn't link to a privacy policy at all.

**Fix.**
- Two new public routes: `apps/web/src/routes/privacy.tsx` and
  `apps/web/src/routes/terms.tsx`
- Initial copy from a generator (Termly, Iubenda, or termsfeed); lawyer
  review listed as a launch-checklist item before public marketing
- Cookie policy as a `#cookies` section inside `/privacy` (deep-linkable)
- Both pages include "Last updated: YYYY-MM-DD" header
- Footer links converted from raw `<a>` to TanStack `<Link>`
- Cookie consent banner gets a `<Link to="/privacy#cookies">Learn more</Link>`
- ToS includes the no-refunds clause: "All sales are final. You may cancel
  your subscription at any time; access continues through the end of your
  current billing period."
- Both pages use the existing typography classes (no new component primitives)

**Acceptance.**
- `/privacy` and `/terms` render with real legal copy
- Cookie banner links to `/privacy#cookies` and the anchor scrolls correctly
- Footer links work
- Lawyer review noted in pre-launch checklist (not a code deliverable)

#### 3.2 Resend production setup

**Status.** Email currently runs in graceful-stub mode locally. No domain
verification, no production API key path documented.

**Fix.**
- Write `docs/RESEND_SETUP.md` modeled on `docs/STRIPE_SETUP.md`: domain
  verification (SPF + DKIM + DMARC), production API key, `EMAIL_FROM` on
  verified domain, RFC 8058 one-click unsubscribe verification
- Update `apps/server/src/lib/env.ts`: when `NODE_ENV=production`,
  `RESEND_API_KEY` and `EMAIL_FROM` must be present. Log a loud warning
  at startup if missing in prod (don't crash — graceful stub still works,
  but ops needs to know)

**Acceptance.**
- Doc walks through Resend dashboard steps with screenshots or precise
  text references
- Server logs `RESEND_API_KEY missing in production` at WARN level when
  applicable
- Test email send to a real Gmail address from staging shows correct
  SPF/DKIM/DMARC pass and one-click unsubscribe works

#### 3.3 Stripe live mode

**Status.** `docs/STRIPE_SETUP.md` already covers the local-dev → live-mode
checklist. No new design work; this is purely a launch-checklist item.

**Fix.** Reference the existing doc in the launch checklist. No code
changes.

#### 3.4 Error monitoring (Sentry)

**Status.** No error monitoring. Production bugs would be invisible until
users complain. Pino structured logs exist but no aggregation/alerting.

**Fix.**
- Add `@sentry/node` to `apps/server`, init in `server.ts` before any
  Fastify plugin registration. Wire as a Fastify error handler
- Add `@sentry/react` to `apps/web`, init in `__root.tsx`. Wrap the
  router error boundary
- Source maps uploaded in production builds via `@sentry/vite-plugin` and
  `@sentry/bun` build hook
- Env vars: `SENTRY_DSN` (server), `VITE_SENTRY_DSN` (web), both optional
  (Sentry stays off in dev)
- PII scrubbing: filter `authorization` headers, request bodies on
  billing/auth routes, JWT contents, and `email` fields from breadcrumbs
- Sample rate: 100% errors, 10% performance traces

**Acceptance.**
- Forced exception in a server route appears in Sentry dashboard with
  source-mapped stack
- Forced exception in a React component appears in Sentry with
  source-mapped stack
- PII fields are confirmed scrubbed in a test event

#### 3.5 `SUPABASE_SERVICE_ROLE_KEY` must be required in production

**Status.** Currently `.optional()` in `env.ts:25`. When unset, four
features fail silently:
- Whitelist invitee notifications (no in-app notification)
- Member email lookups for kick auto-blacklist (kick happens but no
  blacklist insert)
- Member dedup by email on whitelist add
- User profile lookups for various member operations

**Fix.** Change `env.ts`:
- Required when `NODE_ENV=production` (Zod refinement)
- Optional in dev with a loud `WARN` log at startup listing the features
  that will silently fail without it

**Acceptance.**
- Production server fails to start without `SUPABASE_SERVICE_ROLE_KEY`,
  with a clear error message
- Dev server starts without it but logs a warning enumerating disabled features
- Tests still run without it (test env is not "production")

#### 3.6 Export (replaces fake "File uploads" pricing row)

**Status.** Pricing UI advertises "File uploads (20MB/50MB)" for Pro/Max
in `apps/web/src/lib/plans.ts:30,43,53`. Zero implementation exists.
Chargeback risk if Pro/Max users sign up expecting it.

**Fix.** Drop the file-uploads pricing rows entirely. Replace with **Export**
as the first concrete Pro/Max feature.

Export scope (client-side only, no backend):
- Markdown tabs → download as `.md`
- Code tabs → download as `.{ext}` (use existing language registry's file
  extension mapping, or fall back to `.txt`)
- Drawing tabs → use tldraw's built-in `editor.toImage()` for PNG and SVG
  export
- Plan gating: Free users see the Export menu item with an "Upgrade for
  Pro" tooltip and disabled state; Pro/Max enabled
- Export button lives in the tab's existing menu (markdown toolbar overflow,
  or per-tab "..." menu)

**Why client-side.** Yjs already has the source of truth in the browser.
No backend round-trip needed for markdown/code. Drawing export is also
fully client-side via tldraw's API.

**Why this replaces uploads.** Image embeds in a "text file" product
fight Rumi's portability promise — exported `.md` files would have
broken images if you don't operate a CDN, and operating a CDN is its
own can of worms. Export is genuinely useful, ships in 2 days, and gives
Pro/Max a real differentiator.

**Acceptance.**
- Markdown tab → "Export" → downloads valid `.md` file with current content
- Code tab → "Export" → downloads file with correct extension
- Drawing tab → "Export PNG" + "Export SVG" both work
- Free users see disabled menu item with upgrade tooltip
- Pro/Max users export without prompts
- `plans.ts` no longer mentions file uploads

#### 3.7 Deployment

Out of scope for this doc. Listed as a launch-checklist item only:
- Pick host (Fly.io for stateful server, Vercel for web — recommended)
- Set up CI/CD to production
- Env var management (1Password, Doppler, or host-native)

---

### §4. Feature gaps

#### 4.1 Cursor presence in drawing tabs

**Status.** CodeMirror tabs have full cursor + selection presence via
`yCollab(ytext, provider.awareness)` in `tab-cm.tsx:66`. Drawing tabs have
zero awareness wiring — `drawing-tab.tsx` and `drawing/yjs-store.ts` never
reference `provider.awareness`, `presence`, or `cursor`. Other users'
cursors are invisible inside the canvas.

**Fix.**
- Extend `LocalAwareness` (`apps/web/src/lib/collab/awareness.ts:6-9`)
  with optional `cursor?: { x: number; y: number; pageId: string }`
- In `drawing-tab.tsx`, subscribe to tldraw's `editor.on('change', ...)`
  for pointer events; throttle updates to 50–100ms via a leading-edge
  throttle; write to `provider.awareness.setLocalStateField('cursor', ...)`
- Add an effect that observes `provider.awareness` changes and bridges
  remote awareness states into tldraw's presence system via
  `editor.store.put([TLInstancePresence, ...])`. Map fields:
  `user_id → userId`, `display_name → userName`, `color → color`,
  `cursor → cursor`. Camera and selection stay local (cursors-only v1)
- Server-side: add `cursor` to `AwarenessPayloadClient` in
  `apps/server/src/sync/presence.ts:1-4` so it's accepted

**Acceptance.**
- Two browsers in the same drawing tab show each other's pointers as
  named flags with the awareness color
- Throttled updates: pointer movements don't flood the network (visible
  in DevTools WS frames at ~10-20 frames/sec)
- Read-only viewers don't broadcast a cursor
- CodeMirror cursor presence still works (no regression)

#### 4.2 Account deletion (real)

**Status.** `settings.tsx:417-472` has a full "type DELETE" confirmation
flow that toasts "Coming soon" on click. Misleading: users believe their
account is being deleted.

**Fix.** Implement the endpoint and wire the button:

Server: `DELETE /api/account` (auth required)
- For each room owned solely by the user (no other members): soft-delete
  the room (`deleted_at = now()`)
- For each room owned by the user with other members: block deletion with
  a clear error ("Transfer ownership of N rooms before deleting your
  account"). Return 409 with the list of room slugs
- Remove the user from all `room_members` rows where they're not owner
- Remove `notification_preferences` row
- Soft-delete user notifications (or hard-delete; preference: hard-delete
  since they're ephemeral)
- Call Supabase admin API (`auth.admin.deleteUser(userId)`) to schedule
  user deletion
- Sign out the client (return 200 with `{ signedOut: true }`)

Client: replace the toast in `settings.tsx:460-464` with `apiFetch` call
to `/api/account`, then call `signOut()` and redirect to `/` on success.
On 409, surface the room list to the user with a "Transfer ownership"
helper that opens the members dialog for each blocking room.

**Acceptance.**
- Confirmation flow → DELETE call → user is signed out → can't sign back
  in (Supabase reports user deleted)
- If user owns rooms with co-owners/members, deletion blocks with clear
  message
- All `room_members` rows for the user are gone
- The user's owned-and-empty rooms are soft-deleted (purge scheduler will
  hard-delete after 30 days)

#### 4.3 Profile name edit + remove dead Settings UI

**Status.** `settings.tsx:271-280` toasts "Coming soon" on profile name
edit. `settings.tsx:241-244` shows a disabled "Desktop notifications"
toggle with "Coming soon" caption.

**Fix.**
- `PATCH /api/account` accepts `{ displayName: string }` (validated 1-80
  chars, trimmed, non-empty after trim). Calls Supabase admin API
  `auth.admin.updateUserById(userId, { user_metadata: { display_name } })`
- Frontend `commit()` in `settings.tsx` calls `apiFetch` and updates the
  local `useSession` store on success
- **Remove the Desktop notifications toggle entirely** — no UI for
  unimplemented features. If/when desktop notifications ship, the toggle
  comes back

**Acceptance.**
- Editing display name in settings persists; reload shows the new name
- Display name appears correctly in awareness/presence after edit
- Desktop notifications row is gone from the UI

---

### §5. Polish & UX

#### 5.1 SEO metadata for all routes

**Status.** Only the landing page calls `useSeoMeta()`. Sign-in, pricing,
dashboard, settings, and room pages all show "Rumi" (the static `index.html`
title).

**Fix.** Add `useSeoMeta()` calls to:
- `sign-in.tsx`: title "Sign in — Rumi"
- `pricing.tsx`: title "Pricing — Rumi" with description matching plan tiers
- `_authed/dashboard.tsx`: title "Dashboard — Rumi"
- `_authed/settings.tsx`: title "Settings — Rumi"
- `r.$slug.tsx`: title `${room.name ?? room.slug} — Rumi` with appropriate
  OG image. Skip indexing for private rooms (`<meta name="robots" content="noindex">`)
- Add `noindex` to all `_authed/*` routes (these are app pages, not
  marketing)

The `seo.ts` helper already exists; just call it from each route.

**Acceptance.**
- Each route's `<title>` reflects the page
- View-source on a private room page shows `noindex`
- View-source on the pricing page shows correct OG meta + canonical link

#### 5.2 Cookie consent — remove dead toggle, mount globally

**Status.** Two issues:
1. The "marketing" toggle in `cookie-consent.tsx:132-137` stores a
   preference but no marketing pixel/script reads it. Dead toggle.
2. The banner mounts only on the landing page. Users who hit
   `/r/<slug>` directly (e.g. from an email link) never see consent.

**Fix.**
- Remove the marketing toggle from the modal. Keep only "Necessary"
  (always on, disabled UI) and "Analytics" (which gates Plausible
  correctly today)
- Move the cookie consent component out of `landing-page.tsx` and into
  `__root.tsx` so it renders everywhere. Add a guard so it doesn't show
  on `/privacy` or `/terms` (would be visually weird while reading the
  policy)

**Acceptance.**
- Direct visit to a public room shows the cookie banner if not yet
  consented
- The "Marketing" row no longer exists in the preferences modal
- Plausible loads only when analytics consent is granted (existing
  behavior preserved)

#### 5.3 Error boundaries

**Status.** Only `/r/$slug` has a TanStack `errorComponent`. No React
class boundaries, no `react-error-boundary` usage. A render error in
dashboard, settings, or pricing crashes the whole app to TanStack's
default error UI.

**Fix.** Add `errorComponent` exports to:
- `__root.tsx` — top-level boundary for unhandled router/render errors,
  with a friendly "Something went wrong" page and a "Reload" button
- `_authed.tsx` — auth-section boundary
- `dashboard.tsx`, `settings.tsx`, `pricing.tsx` — per-page boundaries
  with consistent fallback UI

Plus a focused boundary inside `drawing-tab.tsx` (lazy-loaded tldraw
+ Yjs binding can throw on schema mismatch). Use `react-error-boundary`
for this one since TanStack `errorComponent` is route-level, not
component-level.

All boundaries report to Sentry (set up in §3.4).

**Acceptance.**
- Forced `throw` in a route component shows the friendly fallback, not a
  white screen
- Sentry receives the error event with route context
- Reloading from the fallback recovers normally

#### 5.4 Loading state audit

**Status.** Some routes have skeletons (rooms list, editor); others jump
from blank to populated. No systematic policy.

**Fix.** Audit each route for these states and ensure each has a visible
indicator (skeleton, spinner, or shimmer):
- Dashboard: rooms list, trash list, subscription pill (already partial)
- Settings: notification prefs fetch, subscription tab fetch
- Pricing: subscription state (for "Current plan" badge)
- Room: presence avatars during initial sync, tab list during control
  doc load

Also: every `apiFetch` that's user-initiated (button clicks) should
disable the button + show inline spinner. Cross-reference the `members-dialog.tsx`
and `create-room-dialog.tsx` for the existing pattern.

**Acceptance.**
- No route has a flash of empty content > 200ms before showing either
  data or a skeleton
- All "save"/"submit" buttons disable + show spinner during in-flight
  requests

#### 5.5 Mobile polish v1

**Status.** `SPEC.md:67` says phone is best-effort. Specific overflow
bugs found in audit:
- Topbar (`topbar.tsx:44`): no responsive collapsing — Share, Members,
  Settings, Bell, PlanBadge, DashboardDropdown all visible at all widths.
  Will overflow at < 600px
- Markdown toolbar (`markdown-toolbar.tsx:38-58`): 8 buttons + language
  picker + view-mode toggle in a non-wrapping flex row. Overflows at
  < 480px
- Tab bar: no responsive handling

**Fix (focused, not a full mobile redesign).**
- Topbar: under `md:` breakpoint, collapse Share/Members/Settings into a
  single overflow menu (existing `MoreVertical` pattern). Bell + PlanBadge
  + DashboardDropdown stay visible (essential)
- Markdown toolbar: add `flex-wrap` so it wraps to multiple rows on narrow
  widths. Hide language picker label (icon-only) under `sm:`. Hide
  formatting buttons except Bold/Italic/Link/Heading under `sm:`; surface
  the rest in an overflow menu
- Tab bar: add `overflow-x-auto` to the tab strip with a scrim affordance
  (gradient fade on the right edge) so users know there's more

Phone remains best-effort. Drawing tabs' tldraw UI remains tldraw's
problem (their built-in mobile UI is functional).

**Acceptance.**
- 375px-wide viewport: topbar fits, no horizontal scroll
- 375px: markdown toolbar wraps cleanly
- 375px: tab strip scrolls horizontally with visible scroll affordance
- No regressions at desktop widths

#### 5.6 Accessibility pass (light)

**Status.** Several icon-only buttons lack `aria-label`. Cookie consent
modal (hand-rolled, not Radix) has no `role="dialog"`. Tab bar has
`role="tab"` on items but no `role="tablist"` wrapper. Settings tabs
use plain buttons with no ARIA.

**Fix.** Concrete additions:
- `members-dialog.tsx:307-314` (whitelist remove): add `aria-label="Remove from whitelist"`
- `members-dialog.tsx:521-529` (member dropdown trigger): add `aria-label="Member options"`
- `members-dialog.tsx:439-444` (add submit): add `aria-label="Add to whitelist"`
- `dashboard.tsx:144-152` (clear search): add `aria-label="Clear search"`
- `dashboard.tsx:219-232` (view toggle): add `aria-label="Grid view"`
  / `"List view"` and `aria-pressed={active}`
- `tab-bar.tsx:291-303` (close tab): add `aria-label="Close tab"` (in
  addition to existing `title`)
- `cookie-consent.tsx:114`: add `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="cookie-prefs-title"`; add `id="cookie-prefs-title"`
  to the heading at line 115. Add an Escape-key handler to close
- `tab-bar.tsx`: add `role="tablist"` to the tab strip wrapper
- `settings.tsx:74-88`: convert top-of-page tabs to `role="tablist"`
  + `role="tab"` + `aria-selected` (or migrate to Radix Tabs primitive)

This is not a full WCAG audit — just close the obvious gaps.

**Acceptance.**
- Screen reader (VoiceOver / NVDA) announces a meaningful label for every
  icon-only button listed above
- Cookie consent modal traps focus and closes on Escape
- Lighthouse a11y score on dashboard improves (target: ≥ 95)

#### 5.7 Guest WS connection IP rate limiting

**Status.** `@fastify/rate-limit` is registered but doesn't apply to
WebSocket upgrade requests (raw `app.server.on("upgrade", ...)` bypasses
Fastify). `authenticateGuest()` does no IP check. A single attacker can
open thousands of guest WS handshakes.

**Fix.** Simple in-memory token bucket on the upgrade handler, keyed by
`request.socket.remoteAddress` (with `x-forwarded-for` fallback if
running behind a proxy):
- Limit: 10 guest connection attempts per minute per IP
- Authenticated upgrades (Bearer token in `sec-websocket-protocol` or
  query string) skip the rate limit
- On exceeded: respond `429` and close the socket before handing off to
  Hocuspocus

Implementation: a `Map<ip, { count, resetAt }>` with periodic cleanup
on a 5-minute interval. Single-instance MVP only — when horizontal scaling
ships (per misc-deferred), this moves to Redis.

**Acceptance.**
- Test: 11 guest WS handshakes from the same IP within 60s; the 11th
  gets `429` and closes
- Authenticated handshakes from the same IP are unaffected
- After 60s, the limit resets

---

### §6. Quick wins (one-line fixes)

These are tiny, independent changes. Group into a single PR for tidiness.

| Item | Change | Evidence |
|---|---|---|
| Pin Bun in CI test job | Add `with: { bun-version: "1.3.13" }` to test job | `.github/workflows/ci.yml:51` |
| Replace purge magic number | `const PURGE_ADVISORY_LOCK_KEY = 7891234;` near top of file with comment explaining intent; reference in `pg_advisory_xact_lock(${PURGE_ADVISORY_LOCK_KEY})` | `apps/server/src/rooms/purge.ts:12` |
| Helmet CSP cleanup | API serves no HTML except the unsubscribe response. Either drop CSP entirely on the API, or scope it to that one route. Recommendation: drop CSP on the API and rely on it only on the web app | `apps/server/src/server.ts:46-55` |
| `invoice.paid` null-warning log | Add `logger.warn({ event: event.id }, "invoice.paid: subscription path not found, skipping")` before the `return null` | `apps/server/src/billing/service.ts:44` |
| Email template URL escape | Wrap `opts.ctaUrl` and `opts.unsubChanUrl` in an HTML-attribute encoder (escape `"`, `<`, `>`, `&`). Defense in depth — current inputs are server-controlled | `apps/server/src/notifications/templates.ts:33,43` |
| Remove legacy `invite_received` notification type | Drop from protocol enum (`packages/protocol/src/notifications.ts:3-7`), DB enum (migration `ALTER TYPE`), `notification-item.tsx:29` dead branch, and the auto-upgrade shim at `notifications/routes.ts:24`. Verify no live notifications still have type `invite_received` (migration `0007:33` already migrated existing rows). Skip if any pre-launch concern about cached client state | Multiple files |
| Remove "File uploads" from pricing | Delete the three lines in `apps/web/src/lib/plans.ts:30,43,53` | `apps/web/src/lib/plans.ts` |

**Acceptance.** Each row's stated change applied. CI green. No behavior
regressions in tests.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| File uploads | Don't build; remove from pricing | Image embeds in a "text file" product fight portability; tldraw default behavior covers the legitimate use case. Replaced by Export. |
| Export | Pro/Max client-side feature | Yjs has source of truth in browser; no backend needed. Real Pro/Max anchor instead of fake one. |
| DB column rename | Yes, rename `invite_received_email` → `access_granted_email` | While we're touching the code, eliminate the triple-naming. Drops the service-layer mapping shim. |
| Schema changes | One migration | Lower migration count; PK + indexes + column rename ship together |
| Cursor presence in drawing | Cursors only, throttled 50–100ms | Reuses existing awareness; selection/camera follow deferred until validated demand |
| Account deletion | Real implementation | Misleading UI is worse than no UI |
| Sentry | Sentry over alternatives | Industry default, both Node + React SDKs mature, source maps story is well-trodden |
| `SUPABASE_SERVICE_ROLE_KEY` | Required in production, optional+warn in dev | Production failures are silent today; dev experience preserved |
| Privacy/ToS copy | Generator + lawyer review | Cheapest path to legitimate copy. Custom-written is overkill at this stage |
| Guest WS rate limit | In-memory token bucket | Single-instance MVP; moves to Redis when horizontal scaling ships |
| Cookie consent location | Mount in `__root.tsx` | Direct-link visitors currently never see it |
| Helmet CSP on API | Remove | API serves JSON; CSP is cosmetic and `'unsafe-inline'` allowance is over-broad |
| Mobile scope | Topbar + markdown toolbar + tab bar overflow only | Phone stays best-effort per SPEC.md; fix the obvious bugs only |

## Rejected Alternatives

- **Build file uploads (image embeds in markdown via Supabase Storage)** —
  Rejected. Solves a self-imposed problem (the pricing-row promise) by
  building a CDN. Image embeds break exported `.md` portability unless
  shipped with a zip-export flow. YAGNI for launch.
- **Build "marketing" cookie pixel before removing the toggle** — Rejected.
  No marketing tooling on the roadmap. Adding a toggle for a thing that
  doesn't exist is the bug.
- **Per-page error boundary as React class components** — Rejected. TanStack
  Router's `errorComponent` covers route-level. `react-error-boundary`
  covers component-level. Class components add no value over these.
- **Hard delete on account deletion** — Rejected. Soft-delete owned rooms
  preserves the 30-day purge window for accidental account deletion.
  Hard-deleting on the spot risks data loss for users who change their
  mind.
- **Move guest rate limit to Redis now** — Rejected. Single-instance MVP
  per SPEC.md. In-memory works; Redis is a horizontal-scaling concern.
- **Tab reorder Y.Array element-order fix** — Rejected. By-design behavior
  with the client correctly sorting by ordinal. No bug. Add a comment
  documenting the contract.
- **Build a full mobile redesign** — Rejected. SPEC.md commits to phone
  being best-effort. Fix overflow bugs, defer everything else.
- **Custom-written legal copy** — Rejected. Generator output reviewed by
  a lawyer is faster and lower-risk than DIY legal writing.

## Edge Cases & Constraints

- **Migration sequencing.** §1.1 (`room_members` PK) requires de-duping
  existing rows. The migration must be tested against a DB seeded with
  duplicates before running in production
- **Existing `notification_preferences` rows.** The `invite_received_email`
  → `access_granted_email` rename must preserve values. Postgres `RENAME
  COLUMN` does this natively; no data migration needed
- **`resolvePlan` rollout.** Changing the conditional means users who
  canceled before this fix and have `currentPeriodEnd` in the past will
  immediately drop to free (correct behavior). Users with
  `currentPeriodEnd` still in the future will *gain* paid access on
  deploy (also correct — restoring the documented behavior). Spot-check
  the canceled-subscription cohort before deploying
- **Account deletion + soft-deleted rooms.** A user who deletes their
  account leaves their soft-deleted rooms behind. The purge scheduler
  cleans these up after 30 days regardless of owner status. No special
  handling needed — but verify the purge query doesn't filter on
  `owner_id`'s existence
- **Cursor presence + read-only viewers.** Read-only guests must not
  broadcast cursors (they'd be invisible-but-active in the awareness
  list). Gate the cursor-broadcast effect on `!readOnly`
- **Sentry source maps + Bun.** `@sentry/bun` is alpha; verify it works
  in CI. Fall back to `@sentry/node` if not (Bun supports `node:*`)
- **Mobile breakpoints.** Tailwind's defaults (`sm: 640px`, `md: 768px`,
  `lg: 1024px`) align with SPEC.md's Phone < 768px definition. Use
  `md:` for the topbar collapse threshold
- **Cookie consent on `/privacy` and `/terms`.** Don't show the banner
  on these pages — visually weird while reading the policy. Use a route
  match guard in `__root.tsx`
- **Guest WS rate limit + IPv6.** `request.socket.remoteAddress` returns
  the full IPv6 address; treat each /64 as one bucket if running on
  IPv6-heavy infrastructure (deferred — start with full-address keying)
- **Stripe API drift.** The `invoice.paid` warning log makes drift
  detectable; the actual upgrade-to-new-Stripe-version is out of scope
- **Supabase admin user deletion.** `auth.admin.deleteUser()` is async on
  Supabase's end. The user may not be fully gone the instant the API
  returns. The frontend should sign out and redirect immediately rather
  than wait for confirmation

## Open Questions

None. All decisions locked.

## Sequencing recommendation

Suggested execution order. Each block is independent of the next; pick
based on priority and risk tolerance.

1. **Migration #1**: §1.1 (PK), §1.4 (column rename), §2 (indexes) — single
   migration, biggest win, blocks nothing
2. **§1.2 `resolvePlan` fix** — independent one-liner with tests; restores
   documented behavior
3. **§1.3 atomicity** — wrap the two functions in transactions
4. **§3.1 Privacy/ToS** — unblocks any public marketing
5. **§3.5 `SUPABASE_SERVICE_ROLE_KEY` required** — surfaces silent failures
6. **§3.4 Sentry** — observability before launching
7. **§3.6 Export + remove file-uploads pricing rows** — concrete Pro/Max value
8. **§4.2 Account deletion** — removes the misleading UI
9. **§4.1 Cursor presence in drawing** — UX polish
10. **§3.2 Resend prod, §3.3 Stripe live, §3.7 Deployment** — launch-checklist
    items, mostly ops work
11. **§5 polish + §6 quick wins** — parallelizable; can interleave with
    earlier blocks

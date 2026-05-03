# Misc Deferred Items

Lightweight stubs for items the TODO references but that aren't ready for full
design work yet. Each entry captures scope, key decisions, and open questions —
enough that whoever picks one up can write a real plan without rediscovering
context. None of these are committed to a release; they're parked here until
prioritized.

---

## Legal Pages — Privacy Policy + Terms of Service

**Why deferred:** Required before the landing page ships publicly. Static content;
no engineering blocker beyond the routes.

**Scope:**
- Two new public routes: `/privacy` and `/terms`
- Static markdown rendered via the same pipeline as the rest of the app (or
  hand-written JSX if simpler)
- Footer links from `/`, `/sign-in`, and the cookie consent modal
- Cookie policy as a section inside `/privacy`, deep-linkable via `#cookies`

**Key decisions:**
- **Source of copy:** use a generator (Termly, Iubenda, or termsfeed) for an
  initial draft, then have a lawyer review before public launch.
- **Versioning:** include "Last updated: YYYY-MM-DD" at the top.
- **Storage:** JSX components with the same Typography classes used elsewhere.
- **Cookie policy placement:** section inside Privacy at `#cookies`, not a
  separate route.
- **GDPR data subject requests:** include an email address (`privacy@rumi.app`)
  for deletion / export requests.
- **Refund language:** ToS includes the no-refunds clause ("All sales are
  final. You may cancel your subscription at any time; access continues through
  the end of your current billing period.").

**Estimated work:** half a day once copy is approved.

---

## Cursor Presence in Editor (v1)

**Why deferred:** Yjs awareness already carries the data we'd need; the only
blocker is UI work and getting it not to feel laggy or busy.

**Scope (v1 — cursors only):**
- Render remote users' cursors **and selection ranges** in CodeMirror tabs
  (`y-codemirror.next` supports both natively)
- Render remote users' cursors in tldraw drawing tabs (bridge Yjs awareness
  into tldraw's user format)
- Show user color + display name as a flag at the cursor position

**Key decisions:**
- `yCollab(ytext, awareness)` wires cursors and selections in one line.
- One cursor per WebSocket connection (natural with Yjs awareness's `clientId`).
- Throttle cursor updates at ~50–100ms.
- tldraw integration: map Rumi's `LocalAwareness` to tldraw's `TLPresence`.

**Estimated work:** 2–3 days for CodeMirror, 1–2 days for tldraw, plus polish.

---

## Room Restore + Trash + Auto-purge

**Why deferred:** Soft delete is in place (`rooms.deleted_at`); restore is
currently manual via a DB write.

**Scope:**
- `POST /api/rooms/:slug/restore` (owner-only) clears `deleted_at`
- "Trash" section in the dashboard listing soft-deleted rooms with restore
  actions
- Auto-purge after 30 days via `pg_cron` or Bun-side scheduled task

**Key decisions:**
- 30-day retention window before hard delete.
- Trash UI shows "Will be deleted in N days."
- No purge-warning email — Trash UI countdown is the only warning.
- Soft-deleted rooms do not count against plan's room limit.

**Estimated work:** 1 day for endpoint + Trash UI; +0.5 day for cron job.

---

## Horizontal Scaling

**Why deferred:** Single-instance MVP. The shape is locked here so the system
grows without architectural surprises.

**Scope:**
- Multiple Hocuspocus server instances behind a load balancer
- Cross-instance broadcast via Redis pub/sub
- Stateless reconnection (no sticky sessions required)

**Key decisions:**
- Ship Redis from the start (`@hocuspocus/extension-redis`) even at
  single-instance scale.
- Sticky sessions not required with Redis-backed shared state.
- Connection limits need Redis-aware cross-instance counting.

**Estimated work:** 1–2 days to wire Redis; +3–5 days when deploying a second
instance (mostly operational).

---

## Mobile Polish

**Why deferred:** Phone (< 768px) is best-effort; tablet is supported.

**Scope:**
- Audit and fix actual breakage on phone widths
- Touch-friendly tab bar
- Markdown toolbar collapses to overflow menu at < 640px (keep Bold/Italic/Link)
- Condensed topbar for phone widths

**Estimated work:** 2–3 days as a focused pass; ongoing fixes.

---

## Export

**Why deferred:** Future monetization lever; gate behind Pro/Max.

**Scope:**
- Download a tab's content as a file (client-side only)
- Markdown → `.md`, code → `.{ext}`, drawing → PNG + SVG
- Plan gating: Free disabled with upgrade tooltip; Pro/Max enabled

**Estimated work:** 2 days for single-tab export + plan-gating UI.

---

## Sequencing notes

Loose suggested order if we tackle these without external prompting:

1. Legal pages — required before public landing-page launch
2. Room restore + Trash + auto-purge — small, immediately useful
3. Export — first paid feature beyond plan limits
4. Cursor presence — high-impact UX polish
5. Mobile polish — ongoing background task
6. Horizontal scaling — only when load demands it

None of these are committed. Each gets a real design doc + plan when prioritized.

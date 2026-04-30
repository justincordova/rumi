# Misc Deferred Items

Lightweight stubs for items the TODO references but that aren't ready for full design work yet. Each entry captures scope, key decisions, and open questions — enough that whoever picks one up can write a real plan without rediscovering context. None of these are committed to a release; they're parked here until prioritized.

Email invites are NOT in this doc — they're folded into `docs/designs/notifications.md` since they share trigger points.

---

## Cross-cutting: Role Model & Tab Permissions

Several items below depend on a richer role model than the current `owner | member`. This section locks in the model so the per-feature stubs can reference it consistently.

> **Note for whoever picks this up:** SPEC.md currently lists "per-user roles beyond owner/member" as an **explicit non-goal** (line 40) and "Authenticated member permissions: Always edit" as a Key Decision (line 273). Implementing this role model means updating SPEC.md in the same iteration — remove those non-goal lines, update the Key Decisions table, and update the `room_members.role` schema documentation around line 324. The tab CRUD rule change (members can no longer create/delete/reorder tabs) is also a SPEC-visible behavior change.

### Roles

Three roles per `room_members` row, plus the owner:

| Role | Powers |
|---|---|
| **Owner** | Everything an admin can do, plus: rename the room, soft-delete the room, transfer ownership, change visibility |
| **Admin** | Tab CRUD (create/delete/reorder), kick members, manage invites, change guest access. Cannot rename, delete, transfer, or change visibility |
| **Member** | Edit existing tab content. Cannot create, delete, or reorder tabs. Cannot manage members |

Schema: extend the existing `role` enum on `room_members` from `('owner', 'member')` to `('owner', 'admin', 'member')`. Migration is a one-line CHECK constraint update; existing rows stay valid.

### Tab CRUD permissions — apply everywhere

**Tab create / delete / reorder is gated to owner + admin in BOTH open and private rooms.** Members can only edit existing tab content. This is a behavior change from MVP (where any member of a private room can create tabs).

Rationale: consistent rules across visibility types are easier to remember and enforce. Open rooms get tighter "structural" protection — random visitors who auto-join can't reshape the room. Private rooms become consistent with that. If owners want collaborators to manage tabs, they promote them to admin.

The 3-tab cap (free tier), 10-tab cap (Pro), 50-tab cap (Max) all still apply on top of permission checks.

### Migration story

Existing `member` rows stay as `member`. The owner of each room is still tracked via `rooms.owner_id`. Owners get implicit admin powers without needing a row change. The new `admin` role is opt-in — owners promote whoever they want.

---

## Legal Pages — Privacy Policy + Terms of Service

**Why deferred:** Required before the landing page ships publicly. Static content; no engineering blocker beyond the routes.

**Scope:**
- Two new public routes: `/privacy` and `/terms`
- Static markdown rendered via the same pipeline as the rest of the app (or hand-written JSX if simpler)
- Footer links from `/`, `/sign-in`, and the cookie consent modal
- Cookie policy as a section inside `/privacy`, deep-linkable via `#cookies`

**Key decisions:**
- **Source of copy:** use a generator (Termly, Iubenda, or termsfeed) for an initial draft, then have a lawyer review before public launch. Don't write it from scratch — boilerplate exists for a reason.
- **Versioning:** include "Last updated: YYYY-MM-DD" at the top. When we materially change either doc, surface a one-time banner asking users to acknowledge.
- **Storage:** JSX components with the same Typography classes used elsewhere. Markdown adds tooling complexity for static content that rarely changes.
- **Cookie policy placement:** section inside Privacy at `#cookies`, not a separate route. Cookie banner's "Cookie preferences" link can deep-link there for users who want detail beyond the modal.
- **GDPR data subject requests:** include an email address (`privacy@rumi.app`) for deletion / export requests. Until we have a self-serve account-deletion endpoint, manual handling is fine at MVP scale.
- **Refund language:** ToS includes the no-refunds clause from `billing.md` ("All sales are final. You may cancel your subscription at any time; access continues through the end of your current billing period. We do not provide refunds for unused time.").

**Implementation notes:**
- DPA (Data Processing Agreement) is not needed for MVP individual plans. Revisit when Team tier or B2B contracts come up.
- The cookie consent banner in `landing-page.md` and the cookie policy section in `/privacy#cookies` must list the same cookie categories. Coordinate during implementation.

**Estimated work:** half a day once copy is approved.

---

## Cursor Presence in Editor (v1)

**Why deferred:** Explicitly listed as a non-goal in `docs/SPEC.md`. Yjs awareness already carries the data we'd need; the only blocker is UI work and getting it not to feel laggy or busy.

**Scope (v1 — cursors only):**
- Render remote users' cursors **and selection ranges** in CodeMirror tabs (`y-codemirror.next` supports both natively in one integration)
- Render remote users' cursors in tldraw drawing tabs (tldraw supports this natively via its own awareness adapter; we'd need to bridge our Yjs awareness into tldraw's user format)
- Show user color + display name as a flag at the cursor position
- Hide own cursor from the rendered output (others see it; we don't need a self-flag)

**Out of scope for v1 (defer to a 'presence v2' pass):**
- tldraw selected-shapes broadcast (showing which shapes another user has selected). Different awareness mapping; ship cursors, observe usage, add shapes later if requested.
- Hover indicators / "viewing this section" highlights.

**Key decisions:**
- **Cursors + CodeMirror selection ranges in one shot.** `y-codemirror.next` ships both via the same `yCollab(ytext, awareness)` integration; cost is mostly CSS. Selections add useful "what is this person doing" context.
- **Identity:** one cursor per WebSocket connection. A user with the same room open in two tabs shows two cursors with the same display name and color. This is natural with Yjs awareness's `clientId` and avoids the "where am I" confusion of merging by `user_id`.
- **Identity stamping:** already enforced server-side in `onAwarenessUpdate` (`apps/server/src/sync/hocuspocus.ts`). The `user_id` and `color` are trusted fields. Display name is client-supplied but already part of `LocalAwareness`.
- **Throttling:** cursor updates are high-frequency; rely on Yjs awareness's built-in debouncing or add a 50–100ms throttle on selection changes.
- **Color contrast:** the deterministic color hash in `presence.ts` needs to be readable in both light and dark themes. May need a luminance check; revisit once we see real cursors.
- **CodeMirror integration:** `yCollab(ytext, awareness)` wires cursors and selections in one line. The work is mostly CSS for the cursor flag and selection-range styling (subtle background tint matching the user's color, alpha ~15%).
- **tldraw integration:** their awareness story is different from CodeMirror's. Add a separate awareness binding that maps Rumi's `LocalAwareness` to tldraw's `TLPresence` shape.

**Implementation notes:**
- Selection-range opacity / color treatment in dark theme needs visual review at implementation time. Start with `color/15%` alpha and adjust if it looks wrong.

**Estimated work:** 2–3 days for CodeMirror cursors + selections, 1–2 days for tldraw cursors, plus polish.

---

## Drag-to-Reorder Tabs

**Why deferred:** Listed as a non-goal in `docs/SPEC.md`. Tabs render in creation order, which is "good enough" for MVP.

**Scope:**
- Drag a tab in the tab bar to a new position
- Position persists across reloads
- Other connected clients see the reorder in real time

**Key decisions:**
- **Permissions:** owner + admin only (per the cross-cutting role model above). Members can edit tab content but not reorder, since reordering is a structural change like create or delete.
- **Server-side ordinals:** the `tabs` table already has a contiguous `ordinal int` column. Reordering means rewriting ordinals for the affected slice, or switching to a fractional indexing scheme (e.g. `ordinal: text` with values like `"a0"`, `"a1"`, `"a05"`).
- **Recommendation:** stick with integer ordinals + a transactional re-pack on reorder. Fractional indexing is more elegant but adds complexity for a feature that's used rarely. Re-packing N tabs (max 50) is trivial.
- **Real-time sync:** the tab list lives in the room control doc as a `Y.Array<TabSummary>`. When the server re-packs, it mutates the Y.Array — clients see it instantly via existing observers.
- **Drag library:** dnd-kit (already a common React choice) or HTML5 drag-and-drop. Recommendation: dnd-kit for the touch story.
- **API:** new endpoint `POST /api/rooms/:slug/tabs/reorder` with body `{ tabIds: string[] }` (the new full order). Server validates length matches DB count, transactionally updates ordinals, broadcasts to control doc.

**Implementation notes:**
- Conflict handling: two admins drag at the same time → last write wins, with the server transaction as the serialization point. Acceptable; no explicit conflict UI needed.

**Estimated work:** 1–2 days.

---

## Member Management — Kick, Leave, Owner Transfer

**Why deferred:** Listed as post-MVP in `docs/TODO.md`. The owner/member model is intentionally simple right now.

**Scope:**
- Owner / admin can remove a member from a room ("kick")
- Member / admin can leave a room they joined
- Owner can transfer ownership to another member or admin
- Owner can promote a member to admin or demote an admin to member

**Key decisions:**

**Kick:**
- Endpoint: `DELETE /api/rooms/:slug/members/:userId` (owner or admin)
- On kick: remove `room_members` row, then call `app.dropRoomConnections(roomId, kickedUserId)` to close their WS sessions
- **Only allowed when `visibility = 'private'`.** In open rooms, kicked users would auto-rejoin on the next page load, so the action is meaningless. Owners who want to kick someone from an open room must change the room to private first — the UI surfaces this with a tooltip or guided dialog.
- Admins cannot kick the owner. Admins cannot kick other admins. Owners can kick anyone except themselves (they must transfer ownership first if they want to leave).
- Kicked user gets a notification (uses the `notifications.md` machinery); future enhancement.

**Leave:**
- Endpoint: `DELETE /api/rooms/:slug/members/me`
- Same flow as kick but self-initiated
- Owner cannot leave; they must transfer ownership first
- Admins can leave normally
- Confirmation dialog client-side

**Transfer:**
- Endpoint: `POST /api/rooms/:slug/transfer-ownership` body `{ newOwnerId: string }`
- New owner must be an existing member or admin
- Updates `rooms.owner_id`, sets the old owner's role to `member` (not admin — explicit choice; old owner can be re-promoted by the new owner if desired)
- Concurrent-user limit reads `room.ownerId`'s plan, so transfer effectively switches the room's quota — flag this in the UI ("Transferring will apply $newOwner's plan limits")
- Two-step UX: "Transfer ownership" button → confirmation modal naming the new owner

**Promote / demote:**
- Endpoint: `PATCH /api/rooms/:slug/members/:userId` body `{ role: 'admin' | 'member' }` (owner-only)
- Owner cannot demote themselves; they'd have to transfer ownership first
- Admin cannot promote another member to admin (avoid escalation chains; only owner manages roles)

**UI placement:** in the room settings dropdown (already exists for rename / copy link / delete) → "Members" item opens a modal listing members with per-row actions (role badge + dropdown for owner; just a role badge when viewed by an admin).

**Implementation notes:**
- Audit log is out of scope. If we need one later, add a separate `room_audit` table — don't try to recover history from the existing `room_members.joined_at` / `role` columns.

**Estimated work:** 3–4 days (larger than a basic kick/leave because of the role-management surface).

---

## Room Restore Endpoint

**Why deferred:** Soft delete is in place (`rooms.deleted_at`); restore is currently manual via a DB write.

**Scope:**
- `POST /api/rooms/:slug/restore` (owner-only) clears `deleted_at`
- "Trash" tab in the dashboard listing soft-deleted rooms with per-row "Restore" actions
- **Auto-purge after 30 days** — periodic cleanup job hard-deletes rows where `deleted_at < now() - 30 days`

**Key decisions:**
- **Discovery:** Trash tab in the dashboard, owner-only, lists rooms with `deleted_at IS NOT NULL` ordered by deletion date. Restore is the row action.
- **Retention:** 30 days, then hard delete. Standard SaaS retention; gives users a recovery window without growing the table indefinitely.
- **Cleanup job:** a `pg_cron` job (Supabase supports this natively) or a Bun-side scheduled task that runs daily. SQL: `DELETE FROM rooms WHERE deleted_at < now() - interval '30 days'`. The `tabs` and `tab_documents` cascade via existing foreign keys. Keep `room_members` cascade as well (already CASCADE on `rooms.id`).
- **Trash UI shows time remaining:** "Will be deleted in N days." Surfaces the urgency.
- **Reactivation behavior:** clearing `deleted_at` should "just work" — the room is identical to its pre-delete state because nothing else was touched.
- **Slug collisions:** soft-deleted rooms still own their slug (the unique constraint applies). No conflict possible. If hard-purge frees a slug, it's reusable for new rooms.

**Implementation notes:**
- **No purge-warning email.** The Trash UI's "Will be deleted in N days" indicator is the only warning users get. Avoids cross-feature coupling with the notifications/email infrastructure and keeps this feature self-contained. If users complain about losing rooms without warning, revisit and add a 7-day-remaining email then.
- Soft-deleted rooms do not count against the plan's room limit (current `createRoom` already filters on `deleted_at IS NULL`). Leave as-is.

**Estimated work:** 1 day for the endpoint + Trash UI; +0.5 day for the cron job.

---

## Horizontal Scaling

**Why deferred:** SPEC.md lists single-instance MVP as explicit. The shape is locked here so the system grows without architectural surprises.

**Scope:**
- Multiple Hocuspocus server instances behind a load balancer
- Cross-instance broadcast for Yjs updates and awareness via Redis pub/sub
- Stateless reconnection (no sticky sessions required)

**Key decisions:**
- **Ship Redis from the start.** Wire `@hocuspocus/extension-redis` (or equivalent) into the server even when only one instance is running. Redis is a no-op / minimal-overhead extra dependency at single-instance scale, but the moment we add a second instance, cross-instance pub/sub already works. Avoids a future "stop the world" refactor where the connection-limit code, the document-load path, and the broadcast path all need to change at once.
- **Sticky sessions: not required.** With Redis-backed shared state, document state is consistent across instances, so reconnection to a different instance "just works."
- **Persistence layer:** unchanged — Postgres is already shared. Only the Hocuspocus in-memory layer + the Redis extension change.
- **Connection limits revisited:** the current `enforceConnectionLimits` iterates `instance.documents`. Once Redis-backed, the same logic needs to query Redis for cross-instance counts. The Hocuspocus Redis extension exposes this. Wire the Redis-aware version of the count up front; degrade gracefully to local-only counts when Redis is unavailable.
- **Trigger for adding a second instance:** when CPU on the single instance exceeds ~70% sustained, or when memory pressure from active documents matters. Both are observable; the design supports adding instances at any point without code changes once Redis is wired.

**Implementation notes:**
- WebSocket load balancer choice (Cloudflare, fly.io, AWS ALB, custom) is an operational decision tied to the hosting story; not a design-doc concern. The load balancer must support WebSocket upgrades and not require sticky sessions.
- Redis hosting (Upstash, Railway, AWS ElastiCache, self-managed) — pick based on the hosting story; no preference here.

**Estimated work:** 1–2 days to wire Redis as a runtime dependency at single-instance scale (and verify nothing regresses). 3–5 days additional when we actually deploy a second instance — most of that is operational (deployment, runbooks, observability), not code.

---

## Mobile Polish

**Why deferred:** SPEC.md lists phone (< 768px) as best-effort; tablet (768–1023px) is supported.

**Scope:**
- Audit and fix actual breakage on phone widths (anything that overflows, breaks, or becomes unusable)
- Touch-friendly tab bar (current may be tight)
- Markdown toolbar adapted for narrow screens — **collapse to overflow menu, keep Bold/Italic/Link visible**
- Drawing tab on mobile: tldraw handles its own touch / gesture story; verify it stays usable
- Consider: phone-only condensed topbar (avatar in a hamburger, room name truncates earlier)

**Key decisions:**
- **Approach:** ship as many small fixes as we can without a dedicated "mobile mode." Tailwind responsive utilities + the existing components.
- **Markdown toolbar treatment:** at `< 640px` (phone), the toolbar collapses. Bold, Italic, and Link stay visible as the most-used actions. Everything else (heading, code-block, list, image, etc.) lives behind a "more" / `…` button that opens a popover with the remaining actions. Standard mobile editor pattern.
- **Out of scope:** native app, mobile-only features, phone-optimized markdown toolbar redesign beyond the overflow collapse.
- **Trigger:** when mobile session share crosses ~10% of traffic, or when user feedback hits a threshold. Until then, keep it best-effort.
- **Testing:** Chrome DevTools device emulation + at least one real iOS Safari pass. No CI mobile testing in MVP.

**Implementation notes:**
- Phone landscape orientation is not a priority. Whatever the layout does naturally is acceptable.
- PWA / installable is out of scope. Revisit only if there's measurable demand.

**Estimated work:** 2–3 days as a focused pass; ongoing fixes as we ship features.

---

## Export

**Why deferred:** Listed as a future monetization lever; revisit after billing is live so we can gate behind Pro/Max.

**Scope:**
- Download a tab's content as a file
  - `tab` type with `language=markdown` → `.md`
  - `tab` type with any other language → `.{ext}` based on language (`.py`, `.ts`, etc.)
  - `drawing` type → **both PNG and SVG** (tldraw supports both natively); user picks via a small format selector in the export menu
- One-click from the tab's settings menu
- **Bulk export deferred to a follow-up.** Single-tab export ships first; bulk-as-zip is a future addition.

**Key decisions:**
- **Where the work happens:** client-side. Yjs has the full content already; no server roundtrip needed for text/markdown. tldraw's `editor.getSvg()` and `editor.toImage()` produce PNG/SVG client-side too.
- **Server involvement:** zero for single-tab exports.
- **Filenames:** `{slug}-{tab-name}.{ext}` with name slugification.
- **Tier gating:** `getUserPlan` lookup before allowing the export action. Free tier: export disabled with upgrade tooltip. Pro/Max: enabled. The UI is a single dropdown menu item that's either enabled or shows a "Pro" badge + tooltip.
- **Drawing format:** both PNG and SVG offered; user picks. SVG default for vector / scalability; PNG for finished raster sharing.

**Implementation notes:**
- Markdown export is raw content only — no frontmatter, no metadata header.
- Drawing SVG export does not need to embed the room/tab name as metadata. Filename carries enough context.
- Import (upload a `.md`, create a tab from it) is a separate design and out of scope for this stub.

**Estimated work:** 2 days for single-tab export + plan-gating UI. Bulk-as-zip in a later iteration: +1–2 days.

---

## Sequencing notes

Loose suggested order if we tackle these without external prompting:

1. Legal pages — required before any public landing-page launch
2. Room restore + Trash + auto-purge — small, immediately useful
3. Role model migration (`admin` role + tab CRUD permission tightening) — prerequisite for member management
4. Member management — uses the role model
5. Export — first paid feature beyond plan limits
6. Cursor presence — high-impact UX polish, not gated
7. Drag-to-reorder tabs — same; uses the role model
8. Mobile polish — ongoing background task
9. Horizontal scaling — only when load demands it

None of these are committed. Each gets a real design doc + plan when prioritized.

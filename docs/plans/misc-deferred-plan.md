# Misc Deferred Items — Plan Index

> **Purpose:** Per-feature execution plans for items currently parked in `docs/designs/misc-deferred.md`. None of these are committed to a release; this index sequences them so they can be picked off one at a time.
> **Design doc:** `docs/designs/misc-deferred.md`

## Why this plan exists

`misc-deferred.md` is a parking lot — it captures scope and key decisions for items that aren't ready for full design work yet. This plan turns each entry into a concrete, executable mini-plan so a contributor can pick one up without rediscovering context.

Each section below is **independently shippable** (with the noted dependencies). Tackle them in any order subject to dependencies; the suggested ordering at the bottom matches the design doc's recommendation.

## Shared prerequisite — `ErrorCode` enum

Several features below throw `AppError` with new codes (`invalid_state` notably). `ErrorCode` is a Zod enum at `packages/protocol/src/errors.ts:3-15`, NOT a freeform string. **`billing-plan.md` Task 5 adds `invalid_state` (along with the Stripe-specific codes) to that enum.** If billing ships first, no extra work needed here. If a misc-deferred feature ships first, add `"invalid_state"` to the enum as part of that feature's first task.

## Current state (verified against codebase)

- `roomMembers.role` enum is `('owner', 'member')` only — `apps/server/src/db/schema.ts:35-37`
- Tab CRUD is gated by a permissive `authorize()` returning `canEdit: true` for any room member — `apps/server/src/rooms/tabs.service.ts` (the `canEdit: true` hardcode)
- Last-tab guard exists (cannot delete the last tab) — `tabs.service.ts:129-131` (per the codebase survey)
- Soft delete is in place; `deleted_at` column exists on `rooms` — `schema.ts:27`. No restore endpoint, no Trash UI, no auto-purge.
- `rooms` query in `service.ts:listRooms` filters on `isNull(rooms.deletedAt)` already
- Drawing uses `YKeyValue<TLRecord>` backed by a `Y.Array` named `"tldraw-v2"` (NOT the `Y.Map` named `"tldraw"` that AGENTS.md describes) — `apps/web/src/lib/drawing/yjs-store.ts:40`
- Cursor presence is not implemented (no `y-codemirror.next` cursor wiring; no tldraw awareness binding for cursors)
- No drag-and-drop library; tabs render in `ordinal` order, no reorder endpoint
- Member management endpoints (kick, leave, transfer, promote/demote) do not exist
- Hocuspocus is single-instance; no Redis extension wired
- Mobile responsiveness is best-effort; markdown toolbar is desktop-first
- No export functionality

## Feature 1 — Legal pages (Privacy + Terms)

**Dependencies:** none. Can ship before billing/landing.
**Why first:** The landing page footer links to `/privacy` and `/terms`; the cookie banner deep-links to `/privacy#cookies`; the ToS contains the no-refunds clause referenced by `billing-plan.md`.
**Estimated work:** half a day after copy is approved.

### Tasks

1. **Source the copy** — use Termly, Iubenda, or termsfeed for an initial draft tailored to:
   - Data collected: email (via OAuth), display name, avatar URL, room/tab content, awareness state
   - Subprocessors: Supabase (auth + DB), Stripe (billing — when shipped), Resend (email — when shipped), Plausible (analytics — when consented), Cloudflare/AWS/etc. (hosting)
   - Right to deletion: contact `privacy@rumi.app`
   - No-refunds clause copied verbatim from `docs/designs/billing.md`
2. **Lawyer review.** Block public launch on this. Until reviewed, the landing-page plan can still ship by linking to placeholder routes that say "Privacy policy is being prepared. Contact privacy@rumi.app."
3. **Routes:**
   - Add `apps/web/src/routes/privacy.tsx` (public)
   - Add `apps/web/src/routes/terms.tsx` (public)
   - Both render hand-written JSX with the same Typography classes as the rest of the app. Don't pull in markdown rendering for static content.
   - Privacy includes `<section id="cookies">` with the cookie policy details. Cookie banner's "Cookie preferences" link can deep-link there.
4. **Versioning:** "Last updated: YYYY-MM-DD" at the top of each page. When the doc materially changes, surface a one-time banner asking signed-in users to acknowledge. Out of scope for the initial ship — flag in TODO.
5. **Footer wiring:** `landing-footer.tsx` (per `landing-page-plan.md` Task 8) already references `/privacy` and `/terms`. Verify links work.
6. **DPA / B2B contracts** — not needed for MVP individual plans.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Feature 2 — Room restore + Trash + auto-purge

**Dependencies:** none. Soft delete is already in place.
**Why early:** Small, immediately useful. Builds trust with users who accidentally delete a room.
**Estimated work:** 1 day for endpoint + Trash UI; +0.5 day for the cleanup job.

### Tasks

1. **Add `POST /api/rooms/:slug/restore` endpoint** (owner-only):
   - In `apps/server/src/rooms/service.ts`, add `restoreRoom(slug, userId)`:
     ```ts
     async restoreRoom(slug: string, userId: string) {
       const room = await db.query.rooms.findFirst({ where: eq(rooms.slug, slug) });
       if (!room) throw new AuthError("not_found", "Room not found");
       if (!room.deletedAt) throw new AppError("invalid_state", "Room is not deleted", 400);
       if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");

       // Check the owner's room cap — restoring a 4th room when the owner has downgraded to free
       // and now has 3 active rooms must be blocked.
       const plan = await getUserPlan(userId);
       const ownedCount = await db.select({ count: sql<number>`count(*)::int` })
         .from(rooms)
         .where(and(eq(rooms.ownerId, userId), isNull(rooms.deletedAt)));
       if ((ownedCount[0]?.count ?? 0) >= plan.maxRooms) {
         throw new AppError("plan_limit_reached", `Restoring would exceed your plan's room limit. Upgrade or hard-delete other rooms first.`, 403);
       }

       const [updated] = await db.update(rooms).set({ deletedAt: null }).where(eq(rooms.id, room.id)).returning();
       return updated!;
     }
     ```
   - Add a new route in `apps/server/src/rooms/routes.ts`: `POST /:slug/restore`. Owner-only.
   - Note: the slug query needs to NOT filter on `isNull(deletedAt)` here — we want to find the soft-deleted room.
2. **List trashed rooms endpoint:**
   - `GET /api/rooms?trash=true` returns `{ rooms: Room[] }` filtered to `WHERE owner_id = $userId AND deleted_at IS NOT NULL`. Owner-only.
   - Or: a dedicated `GET /api/rooms/trash`. Recommendation: the dedicated route is clearer.
3. **Trash UI in dashboard:**
   - Add a "Trash" tab/toggle to `apps/web/src/routes/_authed/dashboard.tsx` (already a list+grid view per the codebase survey). Behind a small dropdown or sub-route.
   - When viewing trash, each row shows "Will be deleted in N days" (computed from `deletedAt + 30 days - now`).
   - Per-row "Restore" button calls the new endpoint and refetches.
4. **Auto-purge cleanup job:**
   - Supabase supports `pg_cron`. Document the SQL:
     ```sql
     SELECT cron.schedule(
       'rumi_purge_deleted_rooms',
       '0 3 * * *',
       $$DELETE FROM rooms WHERE deleted_at < now() - interval '30 days'$$
     );
     ```
   - Cascade rules in `schema.ts` already cascade `tabs`, `tab_documents`, `room_members`, `room_invites` on `rooms.id` deletion. Verify before relying on this.
   - **Alternative if pg_cron isn't available** in the chosen Supabase plan: a Bun-side scheduled task. Add a `cron` package or a simple `setInterval` in `server.ts` (only when `NODE_ENV === "production"`) that runs a purge query daily.
5. **Slug reuse:** soft-deleted rooms still own their slug due to the unique constraint. After hard-purge, the slug is freed. Document this; no code change needed.
6. **No purge-warning email** — per design doc, the Trash UI's countdown is the only warning.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Feature 3 — Role model migration (`admin` role + tab CRUD permission tightening)

**Dependencies:** none, but **prerequisite for Feature 4 (Member management)** and **Feature 7 (Drag-to-reorder)**.
**Why before member management:** the `admin` role is what member management exposes. Tightening tab CRUD permissions is a behavior change visible across both open and private rooms.
**Estimated work:** 2 days. Includes SPEC.md updates.

### Tasks

1. **Update SPEC.md** in the same iteration. Per design doc note: SPEC.md currently lists "per-user roles beyond owner/member" as an explicit non-goal (line 40). Edit:
   - Remove the non-goal line
   - Update the Key Decisions table (around line 273) — replace "Authenticated member permissions: Always edit" with the new role table
   - Update `room_members.role` schema documentation around line 324
   - Document the tab CRUD change: members can no longer create/delete/reorder tabs in any room visibility
2. **Schema migration + role backfill decision:**
   - Edit `apps/server/src/db/schema.ts` — change the role enum:
     ```ts
     role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
     ```
   - `bunx --cwd apps/server drizzle-kit generate`
   - Drizzle handles enum changes via a CHECK constraint update; existing `'owner'` and `'member'` rows stay valid.
   - **Backfill policy — pick one before applying:**
     - **Option A (default):** Leave existing members as `member`. They lose tab CRUD ability instantly (members can no longer create/delete/reorder tabs in any room visibility). Acceptable ONLY if Feature 4 (member management UI for promoting members → admins) ships in the same release. Otherwise existing collaborators are stranded with no way back to admin powers until the owner manually promotes them.
     - **Option B (recommended if Feature 4 doesn't ship same-release):** Promote all current members to `admin` in the migration so existing rooms keep behaving like today. New members default to `member`. SQL:
       ```sql
       UPDATE room_members SET role = 'admin' WHERE role = 'member';
       ```
       Add this to the generated migration file. Owners can demote later via Feature 4 UI when it ships.
   - `bun --cwd apps/server run db:migrate`
3. **Update protocol:**
   - `packages/protocol/src/rooms.ts` — extend the `Role` Zod enum:
     ```ts
     export const Role = z.enum(["owner", "admin", "member"]);
     ```
4. **Tab CRUD permission tightening:**
   - In `apps/server/src/rooms/tabs.service.ts:authorize()`, change:
     ```ts
     return { room, member, canEdit: true, userId };
     ```
     to a role-aware check:
     ```ts
     const canEdit = member.role === "owner" || member.role === "admin";
     return { room, member, canEdit, userId };
     ```
   - Find every call site that uses `canEdit`. Routes that mutate tabs (`createTab`, `updateTab`, `deleteTab`) should throw `forbidden` when `canEdit` is false. **Note for the implementer:** check whether `updateTab` covers content edits. The design says members CAN edit content but can't create/delete/reorder tabs. The current `tabs.service.ts:authorize()` is shared across all tab mutations. Likely the right shape is two flags: `canEditTabContent` (content updates) and `canManageTabs` (structural changes).
     - **Recommendation:** add `canManageTabs: member.role !== "member"` and gate `createTab`, `deleteTab`, and the future reorder endpoint on it. `updateTab` (rename, language change) is structural — also gate.
     - **Open question:** language change on a tab is structural-ish. The design isn't explicit. Recommendation: gate language change as structural (admin+) since it changes the editor experience for everyone in the room.
5. **Owner implicit admin:** owners always get admin powers without needing an `admin` row. Implement this in `authorize()` by treating `member.role === "owner" → canManageTabs: true`.
6. **Update tests:** `apps/server/src/rooms/tabs.service.test.ts` — update existing tests + add cases:
   - Owner can create/delete tabs (no change)
   - Admin can create/delete tabs (new)
   - Member can edit content but not create (new)
   - Open-room auto-joiners are still members → cannot create tabs (new — behavior change)
7. **UI updates:**
   - Hide the "+" tab button for non-admin members. The button currently disables at the 3-tab cap; now it should also disable for members regardless of count. Show a tooltip: "Only admins can add tabs."
   - Tab close (X) buttons: hide for members.
   - Don't yet build promote/demote UI — that's Feature 4.
8. **Existing rooms:** existing `member` rows stay as `member`. No backfill required. Owners promote whoever they want (Feature 4).

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`. **Must include the SPEC.md update.**

---

## Feature 4 — Member management (kick, leave, transfer, promote/demote)

**Dependencies:** Feature 3 (role model). Loosely coupled to `notifications-plan.md` (kicked-user notification).
**Estimated work:** 3-4 days because of the surface area (4 endpoints + UI for each).

### Tasks

1. **Kick endpoint: `DELETE /api/rooms/:slug/members/:userId`**
   - In `service.ts`, add `kickMember(slug, kickerId, kickeeId)`:
     - Owner-only OR admin (admins cannot kick the owner; admins cannot kick other admins)
     - **Reject when target's role is `owner`**, regardless of kicker's role
     - **Only allowed when `room.visibility === "private"`.** Open-room kick is meaningless because the user auto-rejoins via `getRoomBySlug`'s `INSERT ... onConflictDoNothing` (verified at `service.ts:143-150`). Throw `invalid_state` with a message: "Change the room to private before kicking members."
     - Owner cannot kick themselves (must transfer first)
     - Delete `room_members` row
     - Call `app.dropConnectionForUserInRoom(roomId, kickeeId)` (added in Task 7 below). This is the only correct strategy — `dropRoomConnections` is too coarse (kicks every member); `dropUserConnections` from billing-plan is too coarse the other way (drops the user from every room, not just this one).
   - Route: `DELETE /:slug/members/:userId`. Auth required.

2. **Leave endpoint: `DELETE /api/rooms/:slug/members/me`**
   - In `service.ts`, add `leaveRoom(slug, userId)`:
     - Owner cannot leave (must transfer first; surface that error)
     - Admins and members can leave
   - Same connection-dropping logic
   - Route: `DELETE /:slug/members/me`

3. **Transfer ownership: `POST /api/rooms/:slug/transfer-ownership`**
   - Body: `{ newOwnerId: z.string().uuid() }`
   - Service: `transferOwnership(slug, currentOwnerId, newOwnerId)`:
     - Verify `currentOwnerId === room.ownerId`
     - Verify `newOwnerId` is a current member or admin (not the same user)
     - In a transaction:
       - `UPDATE rooms SET owner_id = newOwnerId WHERE id = roomId`
       - `UPDATE room_members SET role = 'member' WHERE room_id = roomId AND user_id = currentOwnerId` (old owner becomes member, NOT admin — explicit per design)
       - `UPDATE room_members SET role = 'owner' WHERE room_id = roomId AND user_id = newOwnerId`
     - Drop room connections so concurrent-user limit re-evaluates against the new owner's plan
   - Route: `POST /:slug/transfer-ownership`. Owner-only.

4. **Promote/demote: `PATCH /api/rooms/:slug/members/:userId`**
   - Body: `{ role: z.enum(["admin", "member"]) }`
   - Service: `updateMemberRole(slug, ownerId, targetUserId, role)`:
     - Owner-only (admin cannot modify roles)
     - Owner cannot modify own role (must transfer first)
   - Route: `PATCH /:slug/members/:userId`

5. **Members list endpoint: `GET /api/rooms/:slug/members`**
   - Returns list of members with `{ userId, role, displayName, avatarUrl, joinedAt }`. Display name + avatar from Supabase admin lookup.
   - Auth: any room member.
   - Used by the Members modal (Task 8).

6. **Protocol schemas:**
   - Add `RoomMember`, `ListMembersResponse`, `UpdateMemberRoleBody`, `TransferOwnershipBody` to `packages/protocol/src/rooms.ts`.

7. **Connection-drop helper:**
   - Add `app.dropConnectionForUserInRoom(roomId, userId)` — closes connections matching both. Scoped variant of the room/user connection dropping. Add to `apps/server/src/server.ts` next to `dropRoomConnections`.
   - Implementation cribs from `dropUserConnections` (added in `billing-plan.md` Task 7). If billing ships first, copy the iteration pattern:
     ```ts
     app.decorate("dropConnectionForUserInRoom", (roomId: string, userId: string) => {
       for (const doc of hocuspocus.documents.values()) {
         for (const conn of doc.getConnections()) {
           // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
           const ctx = conn.context as any;
           if (ctx?.user?.id === userId && ctx?.roomId === roomId) {
             try { conn.close(); } catch { /* ignore */ }
           }
         }
       }
     });
     ```
   - Update `apps/server/src/types.d.ts` to add the new decorator's type signature.

8. **UI: Members modal**
   - Add "Members" item to the room settings dropdown (`apps/web/src/components/topbar.tsx` — between "Visibility" and "Appearance" labels).
   - On click, open a modal listing members with:
     - Avatar + display name + role badge
     - Per-row actions (when viewer is owner):
       - Promote/demote dropdown (member ↔ admin)
       - Kick button (only enabled for non-self, only enabled when room is private — show tooltip if not)
       - Transfer-ownership button (owner viewer only)
     - Self-row: "Leave room" button (owner row hides this; admin/member self-row shows it)

9. **Kicked-user notification:**
   - When a kick succeeds, call `app.notifications.recordNotification(kickeeId, ...)` with a new notification type. **Requires extending the `notifications.type` enum.**
   - **Recommendation:** defer this until after `notifications-plan.md` ships. Track as TODO; not blocking the kick endpoint.

10. **Audit log:** out of scope. If needed later, add a separate `room_audit` table; don't try to reconstruct from `joined_at` / `role`.

### Edge cases

- **Owner downgrade after transfer:** the new owner's plan tightens or loosens the room's concurrent-user cap. Already handled by `enforceConnectionLimits` reading `room.ownerId` on every WS auth. The connection drop after transfer makes this immediate.
- **Pending invite for a kicked user:** the kicked user's invite is gone (the join already consumed it). If they get re-invited, the new invite triggers normally.
- **Transfer to a user who isn't a member:** rejected with `forbidden` — the new owner must be a current member or admin first.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Feature 5 — Export

**Dependencies:** `billing-plan.md` (for the Pro/Max plan gate).
**Why after billing:** Export is the first paid-only feature, so the plan-gating UI needs the billing flow live.
**Estimated work:** 2 days for single-tab export. +1-2 days for bulk-as-zip later.

### Tasks

1. **Single-tab export, client-side only:**
   - **Markdown / code tabs:** read the current `Y.Text` content from `useTabDoc`. Trigger a download via:
     ```ts
     const text = ytext.toString();
     const filename = `${slugify(roomName)}-${slugify(tabName)}.${extForLanguage(tab.language)}`;
     const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
     downloadBlob(blob, filename);
     ```
     `extForLanguage`: `markdown → md`, `typescript → ts`, `python → py`, etc. Build a small map matching the existing language registry in `apps/web/src/lib/markdown/languages.ts`. Default to `.txt`.
   - **Drawing tabs:** use tldraw's editor API:
     ```ts
     // SVG
     const svg = await editor.getSvgString([...editor.getCurrentPageShapes().map(s => s.id)]);
     // PNG
     const blob = await editor.toImage(...);
     ```
     Verify the API names against the installed tldraw version. The design notes both PNG and SVG should be offered; use the menu format selector.

2. **UI: Export menu**
   - Add an "Export" item to the tab's per-tab menu (the small dropdown next to each tab in the tab bar — verify this exists in `apps/web/src/components/tabs/tab-bar.tsx`; if not, attach the export action to a new dropdown).
   - For drawing tabs: a sub-menu with "PNG" and "SVG".
   - For text/code tabs: a single "Download" item.

3. **Plan gating:**
   - `useSession` doesn't currently expose plan info. Add a tiny hook `useUserPlan()` that calls `GET /api/subscriptions/me` once and caches the result. Or extend the existing `useSession` store with a `plan` field populated lazily.
   - In the export menu, when `plan === "free"`, show the menu item with a "Pro" badge and disable it. Tooltip: "Upgrade to Pro to export tabs."
   - Click on the disabled item → navigate to `/upgrade?plan=pro`.

4. **No server endpoint needed.** Single-tab export is entirely client-side; the Yjs document is in memory.

5. **Filename rules:**
   - `slugify` lowercases, replaces non-alphanumerics with `-`, collapses repeats, trims edges.
   - Result: `my-cool-room-welcome.md`, `my-cool-room-untitled.svg`.

6. **Bulk export (deferred):** out of scope for the first ship. Track as a follow-up: ZIP all tabs in a room. Server-side endpoint that streams a zip; or client-side with `JSZip`.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Feature 6 — Cursor presence (v1, CodeMirror + tldraw cursors)

**Dependencies:** none. Depends only on existing awareness wiring.
**Estimated work:** 2-3 days for CodeMirror cursors + selections, 1-2 days for tldraw cursors, plus polish.

### Tasks

1. **CodeMirror cursors + selections:**
   - **Read `apps/web/src/components/editor/tab-cm.tsx` first.** Verified at line 66: `yCollab(ytext, provider.awareness, { undoManager })` is **already wired with awareness**. So the wiring is done; the missing piece is the awareness payload + CSS.
   - The actual gap: y-codemirror.next reads `awareness.getLocalState().user` for `{ name, color }`. Rumi's `LocalAwareness` (per AGENTS.md, `lib/collab/awareness.ts`) provides `display_name`, `color`, etc. **You probably need to set `awareness.setLocalStateField("user", { name: localAwareness.display_name, color: localAwareness.color })` once on mount** so y-codemirror.next can read the right fields. Verify by inspecting the awareness state in DevTools.
   - Verify `y-codemirror.next` is in `apps/web/package.json` (it is — line 16 of `tab-cm.tsx`).
   - Add CSS for the cursor flag (small colored caret + display-name flag):
     ```css
     .cm-ySelection { background-color: var(--user-color-15); }
     .cm-yLineSelection { background-color: var(--user-color-15); }
     .cm-ySelectionCaret { border-left: 2px solid var(--user-color); }
     .cm-ySelectionCaretDot { background: var(--user-color); }
     .cm-ySelectionInfo { ... color flag ... }
     ```
     The `--user-color` and `--user-color-15` (15% alpha) come from the user's color in awareness. y-codemirror.next sets these automatically based on the awareness state's `user.color`. **Verify the awareness shape it expects.** Rumi's existing `LocalAwareness` has `display_name`, `avatar_url`, `user_id`, `color` (server-stamped). y-codemirror.next typically reads `user.name` and `user.color`. Adapt by setting `awareness.setLocalStateField("user", { name: localAwareness.display_name, color: localAwareness.color })` once on mount.

2. **Hide own cursor:** y-codemirror.next does this by default by comparing the local clientId. Verify.

3. **Color contrast in dark theme:** the deterministic color hash in `apps/server/src/sync/presence.ts` produces light/dark-agnostic colors. They may not be readable in both themes. Mitigation:
   - At render time in CSS, compose the cursor color with a luminance-aware text shadow / outline so the flag stays readable.
   - Or: extend `presence.ts` to return BOTH `color` and `colorDark`. Bigger change; defer unless visual review demands it.

4. **tldraw cursors:**
   - Currently there's no awareness binding from Rumi's `LocalAwareness` into tldraw's `TLPresence`. tldraw v4 supports collaborative cursors via the `TLStore.put()` mechanism with `instance_presence` records.
   - In `apps/web/src/lib/drawing/yjs-store.ts`, after `bind(editor)`:
     - On every awareness change from `provider.awareness`, build a `TLInstancePresence` record per remote user and call `editor.store.put([presence])`.
     - Map: `presence.id = pres-<clientId>`, `presence.userId = awareness.user_id`, `presence.userName = awareness.display_name`, `presence.color = awareness.color`, `presence.cursor = ...` (tldraw expects a cursor `{ x, y, type }`; we need to source this from the local user's pointer events and broadcast through awareness).
   - **Cursor x/y** isn't currently in `LocalAwareness`. Add a `cursor: { x: number; y: number } | null` field. Throttle updates at the client to ~50ms.

5. **Throttling:**
   - CodeMirror selections: `y-codemirror.next` debounces internally; verify by watching network traffic.
   - Tldraw cursor positions: throttle via `requestAnimationFrame` or a 50ms `throttle` helper. Don't broadcast on every mouse move.

6. **Out of scope for v1 (defer to v2):**
   - tldraw selected-shapes broadcast (which shapes another user has selected)
   - Hover indicators / "viewing this section" highlights

7. **Tests:**
   - Unit: the awareness adapter that maps Rumi's awareness → CodeMirror's expected `user.{name, color}` shape.
   - Manual: open two browser windows in the same room → cursors and selections visible across both.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Feature 7 — Drag-to-reorder tabs

**Dependencies:** Feature 3 (role model — only admins+ can reorder).
**Estimated work:** 1-2 days.

### Tasks

1. **Server endpoint: `POST /api/rooms/:slug/tabs/reorder`**
   - Body: `{ tabIds: z.array(z.string().uuid()).min(1) }`
   - Auth: room member with `canManageTabs: true` (admin or owner per Feature 3).
   - In `tabs.service.ts`, add `reorderTabs(slug, userId, tabIds)`:
     ```ts
     return db.transaction(async (tx) => {
       const existing = await tx.query.tabs.findMany({
         where: eq(tabs.roomId, room.id),
         orderBy: [asc(tabs.ordinal)],
       });
       if (existing.length !== tabIds.length) throw new AppError("invalid_state", "Tab list mismatch", 400);
       const existingIds = new Set(existing.map(t => t.id));
       if (!tabIds.every(id => existingIds.has(id))) throw new AppError("invalid_state", "Unknown tab id", 400);

       // Two-step to avoid hitting the unique (room_id, ordinal) constraint.
       // Phase 1: bump all ordinals into a temporary range.
       for (let i = 0; i < tabIds.length; i++) {
         await tx.update(tabs).set({ ordinal: 1000 + i }).where(eq(tabs.id, tabIds[i]));
       }
       // Phase 2: settle to 0..N-1.
       for (let i = 0; i < tabIds.length; i++) {
         await tx.update(tabs).set({ ordinal: i }).where(eq(tabs.id, tabIds[i]));
       }
       return tx.query.tabs.findMany({ where: eq(tabs.roomId, room.id), orderBy: [asc(tabs.ordinal)] });
     });
     ```
   - After the transaction, broadcast to the control doc via `broadcastTabsUpdated` (or similar — see `apps/server/src/sync/control.ts`).

2. **Drag-and-drop library:**
   - Add `@dnd-kit/core` and `@dnd-kit/sortable` to `apps/web/package.json`. dnd-kit has a touch story and clean React integration.
3. **TabBar reorder UI:**
   - Wrap the existing tab list in `<DndContext>` + `<SortableContext>`.
   - On drag end, compute the new tab ID order and POST to `/api/rooms/:slug/tabs/reorder`. Optimistically reorder the local state; rollback on failure.
   - The Y.Array<TabSummary> in the room control doc receives the server's broadcast and updates the visible order across all clients.

4. **Permission UI:** for non-admin members, dnd-kit's `disabled` prop on the sortable items keeps tabs draggable visually OFF. Hide drag handles or use a different cursor.

5. **Conflict resolution:** two admins reorder simultaneously → last-writer-wins because the endpoint replaces the entire ordinal slice. Acceptable; design doc explicitly says no special UI.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Feature 8 — Mobile polish

**Dependencies:** none. Ongoing background task.
**Estimated work:** 2-3 days as a focused pass; ongoing fixes as new features ship.

### Tasks

1. **Audit pass on phone widths (< 768px):**
   - Open every public route in Chrome DevTools at iPhone 12 Pro (390x844) and iPad Mini (768x1024).
   - Catalog issues per route:
     - Topbar: room name truncation, dropdown overflow
     - Dashboard: room cards stacking
     - Editor: tab bar tightness, markdown toolbar overflow
     - Drawing: tldraw's own touch story (verify it works)
     - Settings: tab navigation on narrow widths

2. **Markdown toolbar overflow collapse:**
   - In `apps/web/src/components/editor/markdown-toolbar.tsx`, at `< 640px`, collapse non-essential buttons into a "more" (`…`) popover.
   - Keep visible: Bold, Italic, Link.
   - Behind the popover: heading, code-block, list, image, language picker, view-mode toggle.

3. **Topbar phone treatment:**
   - At `< 640px`, hide the visibility badge inline; move it into the room settings dropdown.
   - Truncate room name earlier (`max-w-[120px]` instead of `max-w-[160px]`).
   - Avatar dropdown moves to a hamburger (or stays — it's already small; test).

4. **Out of scope per design:**
   - Phone landscape orientation
   - PWA / installable
   - Native app

5. **Testing:** Chrome DevTools device emulation + at least one real iOS Safari pass before merging.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Feature 9 — Horizontal scaling (Redis extension)

**Dependencies:** none. **Trigger:** when single-instance CPU exceeds ~70% sustained or memory pressure becomes a concern.
**Estimated work:** 1-2 days to wire Redis at single-instance scale; +3-5 days operational work when actually deploying a second instance.

### Tasks

1. **Add `@hocuspocus/extension-redis`:**
   - `bun add @hocuspocus/extension-redis ioredis` from `apps/server/`.
2. **Env vars:**
   - Add `REDIS_URL: z.string().url().optional()` to `env.ts`.
   - When unset, the extension is not registered — single-instance mode unchanged.
3. **Wire the extension:**
   - In `apps/server/src/sync/hocuspocus.ts:buildHocuspocus`, conditionally add the extension:
     ```ts
     import { Redis } from "@hocuspocus/extension-redis";
     // ...
     extensions: [
       persistence,
       ...(env.REDIS_URL ? [new Redis({ host, port })] : []),
     ];
     ```
4. **Connection limits cross-instance:**
   - `enforceConnectionLimits` currently iterates `data.instance.documents` (local). With Redis, the extension exposes a way to query cross-instance connection counts. Update `enforceConnectionLimits` to use it when Redis is available; fall back to local count when not.
   - **Implementation note:** the Hocuspocus Redis extension's API for cross-instance counts may be limited. If it doesn't expose what we need, defer this and document a known limitation: "Single instance counts only. Adding a second instance loosens enforcement until cross-instance counting ships."
5. **Sticky sessions: not required.** Document this in the deployment runbook.
6. **Load balancer requirements:** must support WebSocket upgrades and not require sticky sessions. (Cloudflare, fly.io, AWS ALB all support this.)
7. **Testing:**
   - Verify single-instance behavior is unchanged with `REDIS_URL` set + a local Redis container.
   - Two-instance test: run two server processes pointing at the same Redis + Postgres. Connect a client to instance A, edit a doc; connect another client to instance B; verify edits propagate.

### Pre-commit gate

`bun run check` → `typecheck` → `bun test apps packages` → `vite build`.

---

## Suggested execution order

(Mirrors the design doc's ordering, adjusted for dependencies between features in this index.)

1. **Feature 1 — Legal pages.** Required before public landing-page launch.
2. **Feature 2 — Room restore + Trash + auto-purge.** Small, immediately useful.
3. **Feature 3 — Role model migration.** Prerequisite for Features 4 and 7.
4. **Feature 4 — Member management.** Uses the role model.
5. **Feature 5 — Export.** First paid-only feature; depends on `billing-plan.md`.
6. **Feature 6 — Cursor presence v1.** High-impact UX polish; standalone.
7. **Feature 7 — Drag-to-reorder tabs.** Uses the role model.
8. **Feature 8 — Mobile polish.** Ongoing background task.
9. **Feature 9 — Horizontal scaling.** Only when load demands it.

None of these are committed. Each becomes a real design doc + plan when prioritized — this index is the bridge.

## Documentation hygiene

When any feature in this plan ships:
1. Run `sync-docs` to merge the relevant design-doc section into SPEC.md.
2. Update `AGENTS.md` if the feature changes architectural patterns (e.g. new server module, new route conventions, new schema columns).
3. Delete the corresponding section from `docs/designs/misc-deferred.md`.
4. Track follow-ups (e.g. v2 of cursor presence with shape selection) in `docs/TODO.md`.

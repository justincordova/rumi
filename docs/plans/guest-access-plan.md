# Guest Access Plan

> **Goal:** Replace the 2-mode visibility model with a 3-mode model (`open` / `shared` / `private`) and add guest (anonymous, read-only) access to rooms.
> **Spec:** `docs/designs/guest-access.md`

## Phase 1: Data Layer

**Gate:** Protocol + DB schema updated, migration generated.

### Task 1: Update protocol package

- **What:** Replace the 2-value visibility enum with 3-value, remove `linkCanEdit`, add `allowGuestView`.
- **Why:** Foundation for all downstream changes.
- **How:**
  - File: `packages/protocol/src/rooms.ts`
  - Change `Visibility` from `z.enum(["private", "link"])` to `z.enum(["open", "shared", "private"])`
  - In `Room` schema: remove `linkCanEdit: z.boolean()`, add `allowGuestView: z.boolean()`
  - In `CreateRoomBody`: remove `linkCanEdit`, change `visibility` to new enum, add `allowGuestView: z.boolean().optional()`
  - In `UpdateRoomBody`: remove `linkCanEdit`, change `visibility` to new enum, add `allowGuestView: z.boolean().optional()`
  - In `GetRoomResponse`: remove `linkCanEdit: z.boolean()`, add `allowGuestView: z.boolean()`. Make `role` nullable (`role: Role.nullable()`) — guests don't have a membership role.
- **Verify:** `bun run typecheck` passes from repo root.

### Task 2: Update Drizzle schema + generate migration

- **What:** Update the `rooms` table schema to match the new protocol, then generate a migration that also migrates existing data.
- **Why:** DB must reflect the new model before server code can use it.
- **How:**
  - File: `apps/server/src/db/schema.ts`
  - Change `rooms.visibility` enum from `["private", "link"]` to `["open", "shared", "private"]`
  - Remove `linkCanEdit` column
  - Add `allowGuestView: boolean("allow_guest_view").notNull().default(false)`
  - Generate migration: `bun --cwd apps/server run db:generate` (or `bunx drizzle-kit generate` from `apps/server`)
  - **Edit the generated migration SQL** to add data migration before the column changes:
    ```sql
    -- Migrate existing data: link+canEdit → shared, link+!canEdit → open, private stays private
    UPDATE rooms SET visibility = 'shared' WHERE visibility = 'link' AND link_can_edit = true;
    UPDATE rooms SET visibility = 'open' WHERE visibility = 'link' AND (link_can_edit = false OR link_can_edit IS NULL);
    ```
    Then the auto-generated ALTER statements will handle the enum change and column add/drop.
  - Run migration: `bun --cwd apps/server run db:migrate`
- **Verify:** `bun run typecheck` passes. Migration applies cleanly to Supabase DB.

## Phase 2: Server Backend

**Gate:** HTTP API returns correct responses for both authenticated and guest requests.

### Task 3: Update auth plugin for optional auth on GET room

- **What:** Allow unauthenticated requests to `GET /api/rooms/:slug` while keeping auth required for all other `/api/` routes.
- **Why:** Guests need to fetch room data without a JWT.
- **How:**
  - File: `apps/server/src/auth/plugin.ts`
  - Change the `onRequest` hook: instead of blocking all `/api/` requests without auth, skip auth for `GET /api/rooms/:slug` (match by method + URL pattern).
  - Logic: if `req.url` starts with `/api/` AND it's NOT a `GET` to `/api/rooms/:slug` (regex: `^/api/rooms/[a-z0-9-]+$`), require auth. Otherwise, try auth if header is present but don't block if missing.
  - When `Authorization` is present, still verify and set `req.user`. When absent and the route allows optional auth, leave `req.user` undefined.
- **Verify:** `bun run typecheck` passes.

### Task 4: Update room service for new visibility model + guest access

- **What:** Rewrite `getRoomBySlug` to handle three visibility modes and guest (no user) access. Update `createRoom` and `updateRoom` signatures.
- **Why:** Core business logic change.
- **How:**
  - File: `apps/server/src/rooms/service.ts`
  - `createRoom`: change opts type from `visibility?: "private" | "link"` to `visibility?: "open" | "shared" | "private"`, remove `linkCanEdit`, add `allowGuestView?: boolean`. Default visibility to `"shared"`.
  - `getRoomBySlug`: change signature to `getRoomBySlug(slug: string, userId?: string, userEmail?: string)`. New logic:
    - Fetch room by slug (same as now).
    - **No user (guest):**
      - `open`: return room data, role `null`, `allowGuestView` from room, tabs. No auto-join.
      - `shared`: throw 401.
      - `private` + `allowGuestView=true`: return room data, role `null`, tabs.
      - `private` + `allowGuestView=false`: throw 401.
    - **Authenticated user (userId present):**
      - Check existing membership (same as now).
      - If member: return with their role.
      - If not member and `visibility === "open"` or `visibility === "shared"`: auto-join as member, return.
      - If not member and `visibility === "private"`: check invite (same as now), auto-join if invited, else 403.
    - Return shape: `{ room, role, allowGuestView: room.allowGuestView, tabs }` (replace `linkCanEdit` with `allowGuestView`). `readOnly` is NOT computed here — the WS `connected` hook sends the authoritative `readOnly` via stateless message.
  - `updateRoom`: change body type to use new visibility + `allowGuestView` instead of `linkCanEdit`. Update side-effect detection: trigger `dropRoomConnections` when `visibility` or `allowGuestView` changes.
- **Verify:** `bun run typecheck` passes.

### Task 5: Update room routes for new response shapes

- **What:** Update route handlers and serializers to match the new protocol schemas.
- **Why:** API contract must match the new protocol.
- **How:**
  - File: `apps/server/src/rooms/routes.ts`
  - `GET /:slug`: pass `req.user?.id` and `req.user?.email` (may be undefined for guests). Destructure `allowGuestView` instead of `linkCanEdit` from service result.
  - `POST /`: update createRoom opts to use new fields.
  - `PATCH /:slug`: forward new body shape.
  - `serialize()`: replace `linkCanEdit` with `allowGuestView`.
  - Import updated protocol schemas (Visibility, UpdateRoomBody, etc.).
- **Verify:** `bun run typecheck` passes. `bun run check` passes.

## Phase 3: Server WebSocket

**Gate:** Guests can connect via WebSocket and appear in presence.

### Task 6: Update WS authorize for guest connections

- **What:** Detect guest ID (bare UUID) vs JWT (starts with `eyJ`) in `onAuthenticate`, authorize guests for open/private+guest-view rooms.
- **Why:** Guests need WebSocket access to view (not edit) room content.
- **How:**
  - File: `apps/server/src/sync/authorize.ts`
  - At the top of `onAuthenticate`, check `token.startsWith("eyJ")`:
    - **JWT path (existing flow):** unchanged — verify JWT, resolve membership, set `readOnly`.
    - **Guest path (new):**
      - `token` is the guest UUID.
      - Resolve `documentName` → room (same tab/control-doc resolution logic).
      - Check room visibility:
        - `open`: allow. Set `context = { isGuest: true, guestId: token, roomId, tabId, readOnly: true }`.
        - `private` + `allowGuestView=true`: allow. Same context.
        - `shared` or `private`+`allowGuestView=false`: reject with 4401.
      - No `user` field in context for guests — `guestId` instead.
  - Update `readOnly` logic: for JWT path, `readOnly = false` always (authenticated members always edit). The old `link_can_edit` check is removed.
- **Verify:** `bun run typecheck` passes.

### Task 7: Update hocuspocus hooks for guest presence

- **What:** Handle guest identity in `onAwarenessUpdate` and `connected` hooks.
- **Why:** Guests appear in presence with a deterministic color and "Guest" display name.
- **How:**
  - File: `apps/server/src/sync/hocuspocus.ts`
  - `onAwarenessUpdate`: currently checks `context.user?.id`. Update to also handle `context.guestId`. When `context.isGuest`, stamp `user_id: "guest:${guestId}"` and `color: colorFor(guestId)`.
  - `connected`: no change needed — `readOnly` is already in context for both guests and members.
- **Verify:** `bun run typecheck` passes.

## Phase 4: Client Core

**Gate:** Guest users can load a room page, connect via WebSocket, and see content.

### Task 8: Guest ID management

- **What:** Create a utility to read/generate a persistent guest UUID from localStorage.
- **Why:** Guests need a stable identity for presence without a DB row.
- **How:**
  - New file: `apps/web/src/lib/guest.ts`
  - Export `getGuestId(): string`:
    - Read `localStorage.getItem("rumi_guest_id")`
    - If present, return it
    - If absent, generate `crypto.randomUUID()`, store it, return it
  - Export `isGuest(): boolean` — returns `true` when `useSession.getState().status !== "authenticated"`
- **Verify:** `bun run typecheck` passes.

### Task 9: Move room route outside `_authed` + update loader

- **What:** Move `r.$slug.tsx` out of the `_authed` layout so guests can access it. Update the loader to handle optional auth and guest access.
- **Why:** The `_authed` layout redirects anonymous users to sign-in. Room pages must be accessible without auth.
- **How:**
  - Move `apps/web/src/routes/_authed/r.$slug.tsx` → `apps/web/src/routes/r.$slug.tsx`
  - Update `createFileRoute` path from `"/_authed/r/$slug"` to `"/r/$slug"`
  - Update the loader:
    - Try `apiFetch` (which already sends auth header only if token exists).
    - If it returns 401, redirect to `/sign-in?next=/r/${slug}`.
    - If it succeeds, return the data.
  - Update the `RoomPage` component:
    - Track whether the user is a guest: `const isGuest = useSession(s => s.status !== "authenticated")`
    - Pass `isGuest` to TopBar, TabBar, TabEditor as needed
    - When guest, use `getGuestId()` as the WS token
  - Update `RoomError`: check auth status before redirecting. Authenticated → `/` (dashboard). Guest → `/sign-in?next=<current path>`.
- **Verify:** `bun run typecheck` passes. Authenticated users see rooms as before. Guest URL loads without redirect.

### Task 10: Update Hocuspocus providers for guest token

- **What:** Allow `use-tab-doc.ts` and `use-room-control-doc.ts` to connect with a guest ID when no JWT is available.
- **Why:** Guests need WebSocket connections but have no JWT.
- **How:**
  - Files: `apps/web/src/components/editor/use-tab-doc.ts`, `use-room-control-doc.ts`
  - In both hooks, replace `if (!session.token) return;` with logic that uses guest ID:
    - `const token = session.token ?? getGuestId();`
    - Always create the provider (don't early-return when no JWT).
  - For guest awareness: the server stamps `user_id` and `color` authoritatively (Task 7). The client's job is just `display_name`. Update `buildLocalAwareness(null)` to return `{ display_name: "Guest" }` instead of `{}`. Do NOT send `user_id` or `color` from the client for guests — let the server own identity.
- **Verify:** `bun run typecheck` passes. Guests can connect to open rooms via WebSocket.

## Phase 5: Client UI

**Gate:** Guests see a polished read-only experience with a sign-in prompt.

### Task 11: Guest sign-in banner

- **What:** Add a dismissable banner below TopBar for guests in viewable rooms.
- **Why:** Guests need a clear path to sign in and gain edit access.
- **How:**
  - New component: `apps/web/src/components/editor/guest-banner.tsx`
  - Renders when `isGuest` is true.
  - Text: "Sign in to edit this room" with a "Sign in" button.
  - Button triggers `signInWithProvider("github", currentPath)`.
  - Dismiss button (X) stores dismissed state in `sessionStorage` keyed by room slug.
  - If dismissed, don't show again for this session (refresh re-shows).
  - Integrate in `RoomPage` (in `r.$slug.tsx`): render `<GuestBanner />` between TopBar and TabBar when guest.
- **Verify:** Banner appears for guests. Dismiss works. Sign-in button navigates correctly.

### Task 12: Read-only enforcement for guests

- **What:** Ensure guests see no edit UI — no tab CRUD buttons, no markdown toolbar editing actions, no room settings dropdown, readOnly editors.
- **Why:** Guests are view-only.
- **How:**
  - `apps/web/src/components/tabs/tab-bar.tsx`: hide `+` button (add tab) when `isGuest`.
  - `apps/web/src/components/tabs/add-tab-popover.tsx`: no changes needed if parent hides trigger.
  - `apps/web/src/components/topbar.tsx`: hide settings dropdown (gear icon) when `isGuest`. Replace the avatar/dropdown with a "Sign in" button (primary style, triggers OAuth flow to current path). Show Share button (copy link) for all users.
  - `apps/web/src/components/editor/markdown-toolbar.tsx`: toolbar already receives `readOnly` prop — verify buttons are disabled.
  - `apps/web/src/components/editor/tab-editor.tsx`: `readOnly` already flows through — verify it reaches all editor types.
  - `apps/web/src/components/editor/drawing-tab.tsx`: verify readOnly disables drawing.
  - Pass `isGuest` prop through `RoomPage` → `TopBar` and `TabBar`.
- **Verify:** Guest sees no edit controls. Authenticated member sees all controls.

### Task 13: Room settings visibility selector

- **What:** Update the room settings dropdown to show a 3-option visibility selector and a conditional "Allow guests to view" toggle for private rooms.
- **Why:** Owners need to control the new visibility modes.
- **How:**
  - File: `apps/web/src/components/topbar.tsx` (in the settings dropdown)
  - Replace any existing visibility toggle with a `DropdownMenuSub` containing three radio items: Open, Shared, Private.
  - When Private is selected, show a toggle item below: "Allow guests to view" (maps to `allowGuestView`).
  - On selection, `PATCH /api/rooms/:slug` with the new `{ visibility, allowGuestView }` values.
  - Use `Check` icon to indicate current selection (follow existing pattern in the theme selector).
- **Verify:** Owner can switch between all 3 modes. Private mode shows the guest toggle. Changes persist and propagate.

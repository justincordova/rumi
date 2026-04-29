# Auth and Rooms

## Context

This is the first feature phase that produces real user-facing functionality.
It implements OAuth sign-in via Supabase, JWT-based authorization on the
Fastify server, and the full room CRUD + membership + invite surface that
SPEC.md's permissions model (Pattern B) requires. It also lays the runtime
foundation that `realtime-markdown` consumes: a verified JWT on the request
and a `room_members` row gating access.

This design assumes the `design-system` design doc is implemented before this
phase ships, because every UI surface here uses shadcn components, the prefs
store, and the Tailwind v4 token system.

## Goals

- OAuth sign-in via Supabase (GitHub + Google) using PKCE
- Stateless JWT verification on the server via Supabase JWKS (`jose`)
- Drizzle schema for `rooms`, `room_members`, `room_invites`
- 8 REST endpoints under `/api/rooms` covering create, list, get, update,
  delete, invite create, invite list, invite revoke
- Pattern B semantics: `visibility=link` auto-joins, `visibility=private`
  invite-gates, `link_can_edit=false` flagged to client (server enforcement
  lives in `realtime-markdown`)
- TanStack Router routes `/`, `/sign-in`, `/auth/callback`, `/r/$slug` with
  guarded auth
- Shared Zod request/response schemas via `packages/protocol`
- Standard error envelope with typed error codes
- WebSocket auth refresh strategy declared (reconnect-on-refresh) — consumed
  by `realtime-markdown`
- First shadcn components installed and exercised on real screens

## Non-Goals

- Realtime document sync (`realtime-markdown` design doc)
- Server enforcement of `link_can_edit=false` (Hocuspocus hook in
  `realtime-markdown`)
- Sending invitation emails (MVP shares URLs manually; SES/Resend integration
  is post-MVP)
- Member management endpoints (kick, leave, owner transfer) — post-MVP
- A hard-delete or restore endpoint for rooms — post-MVP
- Room settings UI beyond `PATCH /api/rooms/:slug` (full settings panel is its
  own design doc)
- Username-based invites (Supabase has no native username field; email-only)
- Server-synced user prefs (per SPEC.md: client-only)

## Design

### File layout

**Backend (`apps/server/src/`):**

```
auth/
  verify.ts          # JWT verification via JWKS+jose; replaces stub
  jwks.ts            # cached jose.createRemoteJWKSet
  plugin.ts          # Fastify plugin: decorates request.user, gates with onRequest
  errors.ts          # AuthError + standard envelope helper
rooms/
  schema.ts          # re-export of protocol Zod schemas
  service.ts         # pure DB operations
  routes.ts          # 8 Fastify routes
  slug.ts            # unique-names-generator wrapper + collision retry
  invites.ts         # invite resolution helper
db/
  client.ts          # drizzle client (postgres-js)
  schema.ts          # Drizzle table definitions
  migrations/        # drizzle-kit output
```

**Frontend (`apps/web/src/`):**

```
routes/
  __root.tsx                  # ThemeProvider + TooltipProvider + Sonner mount
  sign-in.tsx                 # public: OAuth provider buttons
  auth.callback.tsx           # PKCE code exchange (sibling of _authed; no auth guard)
  _authed.tsx                 # pathless layout: beforeLoad checks session
  _authed/index.tsx           # dashboard
  _authed/r.$slug.tsx         # room shell (filled by realtime-markdown)
lib/
  auth.ts                     # supabase client + useSession + signIn/signOut
  api.ts                      # typed fetch client over protocol schemas
stores/
  rooms.ts                    # Zustand: my rooms, current room
components/
  topbar.tsx                  # two-mode TopBar: dashboard config + room config (extended in realtime-markdown)
  rooms/
    create-room-dialog.tsx
    invite-dialog.tsx
    delete-room-dialog.tsx    # AlertDialog confirmation for soft delete
    room-card.tsx
    empty-state.tsx           # rendered when user has no rooms
```

Note: there is no `RenameRoomDialog`. Both the dashboard RoomCard and
the in-room TopBar use **inline rename** (click-to-edit; commit on
blur/Enter; cancel on Escape; empty value falls back to slug-as-title).
A modal would force two interaction patterns for the same action; one
inline pattern across both surfaces matches the prototype.

`__root.tsx` mounts `<TooltipProvider>` from `@radix-ui/react-tooltip`
(via shadcn) at app root. The TopBar's presence avatars and several
icon-only buttons rely on Radix tooltips that require the provider in
scope.

`__root.tsx` also mounts the Sonner `<Toaster />` with theme bound to
`next-themes`'s `useTheme()` and class names bound to design tokens, so
toasts stay in lockstep with theme changes without flashing:

```tsx
<Toaster
  theme={theme as "light" | "dark" | "system"}
  className="toaster group"
  toastOptions={{
    classNames: {
      toast: "group bg-background text-foreground border-border shadow-lg",
      description: "text-muted-foreground",
      actionButton: "bg-primary text-primary-foreground",
      cancelButton: "bg-muted text-muted-foreground",
    },
  }}
/>
```

`auth.callback.tsx` is a flat sibling of `_authed`, not nested under it. The
PKCE exchange runs *without* the auth guard so an unauthenticated user can
complete sign-in (otherwise the `_authed` `beforeLoad` would loop them back
to `/sign-in` forever).

**Protocol (`packages/protocol/src/`):**

```
index.ts            # re-exports
rooms.ts            # Zod schemas for all 8 endpoint shapes
errors.ts           # ErrorEnvelope schema + ErrorCode union
```

### Auth flow

**Sign-in:**

1. Unauthed user hits any `_authed` route. `beforeLoad` runs
   `supabase.auth.getSession()`; null → throws
   `redirect({ to: '/sign-in', search: { next: location.pathname } })`.
2. `/sign-in` shows two OAuth buttons. Click triggers
   `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: '${origin}/auth/callback?next=${next}' } })`.
3. Provider redirects back to `/auth/callback?code=...&next=...`. The route
   component calls `supabase.auth.exchangeCodeForSession(code)`. On success
   navigate to `next` or `/`. On error toast and redirect to `/sign-in`.

**Session lifecycle (`apps/web/src/lib/auth.ts`):**

- Wraps `supabase.auth.onAuthStateChange` and exposes a Zustand-backed
  `useSession()` hook. The `_authed` `beforeLoad` reads from this store.
- On `TOKEN_REFRESHED`, the store updates with the new JWT. The
  `realtime-markdown` phase will subscribe to this and reconnect its
  `HocuspocusProvider`.
- On `SIGNED_OUT`, the store clears and `router.invalidate()` is called,
  forcing the next `beforeLoad` to redirect to `/sign-in`.

`Session` shape exposed by the store:

```ts
interface Session {
  user: {
    id: string;             // Supabase user id (UUID, JWT `sub`)
    email: string;          // lowercased
    displayName: string;
    avatarUrl: string | null;
  } | null;
  token: string | null;     // current access JWT
  status: "loading" | "authenticated" | "anonymous";
}
```

OAuth metadata extraction (`extractProfile(supabaseUser)` in
`apps/web/src/lib/auth.ts`) handles GitHub and Google's differing field
names with a fallback chain. The helper treats empty strings as
fall-through (some Supabase configs return `""` rather than `undefined`
for missing metadata), so the chain only stops on a non-empty trimmed
value:

```ts
function pickNonEmpty(...vs: (string | null | undefined)[]): string | null {
  for (const v of vs) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function extractProfile(u: SupabaseUser) {
  const m = u.user_metadata ?? {};
  return {
    id: u.id,
    email: (u.email ?? "").toLowerCase(),
    displayName:
      pickNonEmpty(
        m.full_name,           // Google primary; GitHub when set in profile
        m.name,                // GitHub primary
        m.user_name,           // GitHub username fallback
        u.email?.split("@")[0],
      ) ?? "Unknown",
    avatarUrl: pickNonEmpty(
      m.avatar_url,            // GitHub primary
      m.picture,               // Google primary
    ),
  };
}
```

Synchronous pure function; covered by unit tests with mocked Supabase
user objects for both providers, including the empty-string fall-through
case.

**`lib/api.ts`** is a typed fetch wrapper that reads `useSession.getState().token`
at call time and attaches it as `Authorization: Bearer <jwt>`. TanStack Router
loaders use it directly (`fetchRoom`, `listRooms`); the store hydrates before
any `_authed` route renders, so loader calls always have a token.

On 401 responses, the wrapper does **not** sign out immediately — a 401
can fire for transient reasons (token expired moments before refresh,
JWKS cache miss during Supabase key rotation, server clock skew). Recovery
flow:

1. Call `supabase.auth.refreshSession()`.
2. If refresh succeeds, retry the original request once with the new token.
3. If refresh fails (or the retry also returns 401), call
   `supabase.auth.signOut()` which fires `SIGNED_OUT` →
   `router.invalidate()` → redirect to `/sign-in`.

A small per-request `retried` flag prevents infinite refresh-retry loops.

**Server-side verification:**

1. `auth/jwks.ts` exports a singleton `JWKS = createRemoteJWKSet(new URL(...))`
   with `cacheMaxAge: 10 * 60 * 1000` (10 min) and `jose`'s default
   `cooldownDuration` of 30s on unknown `kid` (re-fetches JWKS once per
   cooldown when a JWT references a key not in the cache; covers Supabase
   key rotation with a brief 401 spike).
2. `auth/plugin.ts` is a Fastify plugin that registers an `onRequest` hook on
   all routes prefixed with `/api/`. The hook reads
   `Authorization: Bearer <jwt>`, calls `jose.jwtVerify(token, JWKS, { issuer, audience })`,
   attaches `{ id: payload.sub, email: payload.email.toLowerCase() }` to
   `request.user`, and 401s on any failure.
3. `auth/verify.ts` exports the bare `verifyJwt(token)` function used both by
   the plugin and (in `realtime-markdown`) by Hocuspocus's `onAuthenticate`
   hook — single verification path.

### Env vars

Added to `.env.example` during execute. Cloud Supabase is the only Postgres
(per SPEC.md "Postgres (Supabase)" component); `DATABASE_URL` points at
the developer's Supabase project, not local Docker.

**Server (`apps/server`):**
- `DATABASE_URL` — Supabase Postgres connection string (use the
  *connection pooler* string from the Supabase dashboard, not direct, for
  reliable behavior under reconnects)
- `SUPABASE_JWKS_URL` — e.g. `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`
- `SUPABASE_JWT_ISSUER` — e.g. `https://<project>.supabase.co/auth/v1`
- `SUPABASE_JWT_AUDIENCE` — typically `authenticated`
- `PORT` — defaults to `3000`
- `WEB_ORIGIN` — CORS allowlist; dev default `http://localhost:5173`

**Web (`apps/web`):**
- `VITE_API_URL` — e.g. `http://localhost:3000`
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key (public)

`VITE_WS_URL` is added in the realtime-markdown phase.

Scaffolding currently sets server port to 3001 and includes
`docker-compose.yml` for local Postgres; both are removed during the
auth-and-rooms execute phase per SPEC.md's cloud-Supabase decision.

### Security headers

Scaffolding already registered `@fastify/helmet`. Two adjustments needed in
this phase:

- `connect-src` — must allow the Supabase URL and (in realtime-markdown)
  the WS origin. Add to Helmet's `contentSecurityPolicy.directives`.
- `script-src` — the design-system phase ships an inline anti-flash script
  in `index.html`. Either add `'unsafe-inline'` for `script-src` (acceptable
  for a tiny static script with no user input) or generate a per-response
  nonce. MVP picks `'unsafe-inline'`; nonce-based hardening is a deploy-time
  concern.

**No CSRF middleware.** Bearer-token auth in the `Authorization` header is
not vulnerable to CSRF — browsers don't auto-attach the token to
cross-origin requests the way they would a session cookie. PKCE handles
OAuth state; Supabase's `exchangeCodeForSession` validates the verifier.
We do not register `@fastify/csrf-protection`. Documented here so future
plan-time reflexes don't add it.

**Error envelope:**

```ts
{ error: { code: ErrorCode, message: string, details?: unknown } }
```

`ErrorCode` union: `unauthorized | forbidden | not_found | validation_failed | slug_taken | invite_not_found | server_error`.

### Drizzle schema

`apps/server/src/db/schema.ts`:

```ts
import { pgTable, uuid, text, timestamp, boolean, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name"),
  ownerId: uuid("owner_id").notNull(),
  visibility: text("visibility", { enum: ["private", "link"] }).notNull().default("link"),
  linkCanEdit: boolean("link_can_edit").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  slugUq: uniqueIndex("rooms_slug_unique").on(t.slug),
  ownerIdx: index("rooms_owner_idx").on(t.ownerId),
}));

export const roomMembers = pgTable("room_members", {
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.roomId, t.userId] }),
  userIdx: index("room_members_user_idx").on(t.userId),
}));

export const roomInvites = pgTable("room_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  invitedEmail: text("invited_email").notNull(),
  invitedBy: uuid("invited_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, (t) => ({
  emailRoomIdx: index("room_invites_email_room_idx").on(t.invitedEmail, t.roomId),
}));
```

Notes:

- `invitedEmail` lowercased at write time. JWT email lowercased on read.
  Application-side normalization keeps the index usable.
- FK `onDelete: "cascade"` means a future *hard* delete cleans up
  automatically; soft delete leaves rows in place per "Soft delete cascade"
  below.
- No FKs to Supabase's `auth.users` table. Cross-schema FKs are technically
  possible (Supabase Postgres is one DB) but skipped for MVP simplicity.
- **Validation (Zod schemas in `packages/protocol`):**
  - `name`: `z.string().trim().min(1).max(100).optional()`
  - `email`: `z.string().email().toLowerCase().max(254)` (RFC 5321 limit)
  - `visibility`: `z.enum(["private", "link"])`
  - `linkCanEdit`: `z.boolean()`
  - `slug` (path param): `z.string().regex(/^[a-z0-9-]+$/).max(64)`
- **XSS surface.** Room names render as text in TopBar, RoomCard, dialogs.
  React escapes by default. We never set `dangerouslySetInnerHTML` from
  user-supplied content. `document.title` updates use the `textContent`
  path, not `innerHTML`. Trim + length cap keep names from being abusive.

### HTTP endpoints

All require `Authorization: Bearer <jwt>`. Errors return the envelope shape.

```
POST /api/rooms
  body: { name?, visibility?, linkCanEdit? }
  → 201 { room }
  Behavior: generate slug, insert rooms + room_members(role=owner) atomically.

GET /api/rooms
  → 200 { rooms }
  Behavior: rooms where user is a member OR has a pending invite.
            Filtered for deleted_at IS NULL.

GET /api/rooms/:slug
  → 200 { room, role, linkCanEdit }
  → 404 if not found / soft-deleted
  → 403 if visibility=private and not member and no matching invite
  Behavior:
    1. Look up room by slug.
    2. If user is already a member → return.
    3. If visibility=link → insert room_members(role=member) (ON CONFLICT
       DO NOTHING) → return.
    4. If visibility=private → check room_invites for jwt.email; if found,
       insert member + stamp accepted_at atomically → return; else 403.

PATCH /api/rooms/:slug   (owner only)
  body: { name?, visibility?, linkCanEdit? }
  → 200 { room }
  → 403 if not owner
  Side effect (when visibility or linkCanEdit change):
    Calls dropRoomConnections(roomId) — a helper that iterates every
    tab connection in the room and the room's control-doc connection,
    calling hocuspocus.closeConnections() on each. All affected WS
    connections drop and reconnect, picking up the new
    readOnly/membership decision via onAuthenticate. See
    realtime-markdown.md for the implementation. name-only PATCHes
    don't trigger this.

DELETE /api/rooms/:slug  (owner only)
  → 204; sets deleted_at = now().
  Side effect: calls dropRoomConnections(roomId). All connected clients
  drop, attempt reconnect, get not_found from onAuthenticate, toast and
  redirect to /. See realtime-markdown.md.

POST /api/rooms/:slug/invites    (owner only)
  body: { email }
  → 201 { invite }
  Behavior: lowercase email; idempotent on (slug, email) pending row.
  Does NOT pre-check whether the email already belongs to a member.
  Drizzle has no FK to auth.users and we deliberately don't reach
  cross-schema. If the email is already a member, the invite stays
  pending forever and silently no-ops on subsequent resolution attempts
  (the member-insert is idempotent via ON CONFLICT DO NOTHING).
  Cosmetic deduplication can be added later if it matters.

GET /api/rooms/:slug/invites     (owner only)
  → 200 { invites }     (acceptedAt IS NULL only)

DELETE /api/rooms/:slug/invites/:id   (owner only)
  → 204
```

Returned `Room` shape:

```ts
{ id, slug, name, ownerId, visibility, linkCanEdit, createdAt, updatedAt }
```

The `role` and `linkCanEdit` from `GET /api/rooms/:slug` are UI hints. The
real read-only enforcement is server-side in `realtime-markdown`'s Hocuspocus
hooks.

### Frontend routing & UX

**Route tree (TanStack Router file-based):**

```
__root.tsx          # ThemeProvider, Sonner toaster, <Outlet />
sign-in.tsx         # public: 2 OAuth buttons
auth.callback.tsx   # PKCE exchange spinner
_authed.tsx         # beforeLoad → /sign-in if no session
  index.tsx           # dashboard: rooms list + create + invite badge
  r.$slug.tsx         # room shell (realtime-markdown fills in editor)
```

**`/sign-in`** — full-viewport `bg-gradient-subtle` background with a
`grid-dots opacity-30` overlay. Centered card (`max-w-sm w-full
bg-surface/80 backdrop-blur-md border border-border rounded-2xl
shadow-lg p-8`) with `animate-fade-in` on mount. Inside the card, in
order:

- Brand tile, 12×12: `bg-gradient-brand rounded-2xl shadow-float
  flex items-center justify-center` containing a `Sparkles` lucide
  icon (`h-5 w-5 text-primary-foreground strokeWidth=2.5`).
- Headline: `font-display text-2xl font-semibold tracking-tight
  text-balance` reading "Welcome to Rumi".
- Subtitle: `text-sm text-muted-foreground` reading "Sign in to
  start collaborating."
- Two OAuth buttons stacked vertically (`flex flex-col gap-2 w-full`).
  Each `variant="outline"`, `h-10 w-full`, with a lucide GitHub or
  Google icon (the latter via `react-icons/fc` for the multi-color
  Google logo, since lucide is monochrome). No "preferred" provider —
  buttons are visually identical.

Centered card spacing: 24px between brand tile and headline, 8px
between headline and subtitle, 24px between subtitle and the button
group.

**`/auth/callback`** — minimal centered spinner. `useEffect` extracts `code`
from search, calls `exchangeCodeForSession`, navigates to `next ?? '/'` on
success or to `/sign-in` with a toast on error. Error categories surfaced:
provider rejection (`error_description` in search params), exchange failure
(network error, expired code, mismatched PKCE verifier), and missing-code
(user landed here without going through `/sign-in`). All map to the same
"Sign-in failed — please try again" toast at MVP; granular error UX is
post-MVP.

**`/` (dashboard)** — TopBar in **dashboard config** (see "TopBar" below).
Header "Your rooms" + create-room button. Grid of `<RoomCard />`s. Each
card displays the room title (room.name when set; slug as title otherwise —
e.g. `wispy-falcon-42`), visibility badge, owner pip, "pending invite"
badge for unjoined-but-invited rooms. Owner cards include a "..." menu
with one action — "Delete" (opens `<DeleteRoomDialog />`). Renaming on the
dashboard is **inline** — double-click the title on the card to edit;
commit on blur/Enter; cancel on Escape; empty value resets to slug.
Loading: `<Skeleton />` cards. **Empty state** — when the user has zero
rooms, render `<EmptyState />` (visual ref:
`docs/_refs/rumi-collab/src/components/rumi/EmptyState.tsx`) with the
create-room CTA centered, instead of the empty grid. EmptyState layout:
- Full-bleed `bg-gradient-subtle` with `grid-dots opacity-40` overlay
  and a top fade `bg-gradient-to-b from-background to-transparent`.
- Centered 12×12 brand tile (`bg-gradient-brand rounded-2xl shadow-float`
  with `Sparkles` icon) using `animate-fade-in`.
- Headline `font-display text-3xl font-semibold tracking-tight
  text-balance` reading "Start your first room".
- Subtitle `text-muted-foreground max-w-md text-balance` reading
  "Spin up a shared room. Anyone with the link will see your edits in
  real time."
- A primary "Create room" button (`h-10 px-5 rounded-md`) opening the
  `<CreateRoomDialog />`.
- Footer tip line in `text-[12px] text-muted-foreground` reading "Tip
  — you can create up to **3 rooms** on the free plan." Bold the
  number with `font-medium text-foreground`. (Pricing/upgrade copy
  stays informational; no upgrade flow exists yet.)

Slug-as-title is the deliberate default — leaving the name blank at
creation produces a memorable, playful identifier (`wispy-falcon-42`)
rather than a pile of "Untitled" rooms. Owners can rename at any time
via inline edit on the dashboard card or in the room TopBar; both call
`PATCH /api/rooms/:slug { name }`.

**`<CreateRoomDialog />`** — optional name, visibility radio (Private /
Anyone with link), `link_can_edit` switch (only enabled when
visibility=link). Submit → POST `/api/rooms` → toast success → navigate to
`/r/${slug}`.

**`<InviteDialog />`** — email input, "Send invite" button, list of pending
invites with revoke buttons. Helper text: *"Tell them to sign in with this
email to join the room."* — MVP doesn't actually send email; copy stays
domain-agnostic until a production domain is acquired.

**`<DeleteRoomDialog />`** — shadcn `AlertDialog` with "Delete this room?
This soft-deletes the room and removes it from your dashboard. The room's
content is preserved but inaccessible." Confirm → `DELETE /api/rooms/:slug`
→ remove from list → toast "Room deleted." Add `AlertDialog` to the shadcn
install list for this phase.

**`/r/$slug`** — auth-and-rooms phase only renders the shell: TopBar in
**room config** + placeholder for the editor (filled by realtime-markdown).
Loader fetches `GET /api/rooms/:slug`; on 404 → toast + redirect to `/`;
on 403 → toast "You don't have access" + redirect to `/`.

### TopBar

A single `<TopBar />` component with two configurations driven by props:
**dashboard** (no `room` prop) and **room** (with `room` prop; the
`provider`/`status` props are added in realtime-markdown). Layout: a
single horizontal bar, `h-14`, full width, `border-b border-border`,
`bg-surface/80 backdrop-blur-md` for a frosted look.

**Always present (left side):**
- Brand tile: 28×28 `rounded-md` with `bg-gradient-brand` and a Sparkles
  lucide icon (`text-primary-foreground`).
- Wordmark: "Rumi" in `font-display` at `text-[15px] tracking-tight`.

**Dashboard config (right side):**
- Avatar dropdown (`@radix-ui/react-dropdown-menu` via shadcn). Avatar
  is 28×28 round, ringed, falls back to initials when no `avatar_url`.
  Menu items: "Settings" (links to `/settings` — built post-MVP),
  "Sign out".

**Room config (left, after wordmark):**
- A vertical 1px divider, then:
- **Inline editable room title.** Renders as a button-shaped element
  with the current title (room.name or slug). Click → swap to an
  `<input>` with focus and `inputRef.current?.select()` so users can
  immediately overwrite. Commit on blur/Enter (`PATCH /api/rooms/:slug
  { name }`); empty submit clears `room.name` and the title falls
  back to slug-as-title. Escape **resets the draft to the current
  title before exiting edit mode** (prevents a stale draft on next
  open). Hover reveals a small "rename" hint label to telegraph the
  affordance. Input chrome in edit mode: `border border-border
  bg-surface rounded-md px-2.5 py-1 text-sm font-medium ring-2
  ring-ring/30 outline-none`.

**Room config (right side):**
- **"Live" pill** — `hidden sm:flex`, rounded-full, `bg-success/10`
  border `border-success/30`, with a `bg-success` 6px dot using
  `animate-pulse-soft`, and the text "Live" in `text-[11px]
  text-success font-medium`. Renders only when `provider.status ===
  "connected"`. Hidden during reconnect; the corner `<ConnectionStatus />`
  pill takes over for the transient state (see realtime-markdown).
- **Presence avatars** — overlapping stack with `-space-x-1.5`, each
  avatar `h-7 w-7 rounded-full ring-2 ring-surface text-[11px]
  font-semibold` colored by the user's deterministic presence hue
  (`--color-presence-1` through `-5`). Hover lifts the avatar
  (`hover:-translate-y-0.5 transition-transform`). Tooltip via Radix
  shows the user's display name. Up to 4 visible avatars; "+N" pip
  shown when the room has more than 4 connected users (the prototype
  cuts at 4; we follow the prototype here, not the prior docs that
  said 5).
- **Share button** — primary inverse style: `bg-foreground
  text-background`, `rounded-md`, `h-8`, `px-3`, `shadow-sm
  transition-all hover:bg-foreground/90 hover:shadow-md`, lucide
  `Link2` icon + label "Share". Click copies `window.location.href`
  to clipboard and shows a Sonner toast with `title: "Link copied"`
  and `description: "Anyone with this link can join."`
  (description text becomes `"Invitees only."` for `visibility:
  private`). On clipboard error: `toast.error("Could not copy link")`.
  Icon swaps to `Check` for 1.6s after a successful copy.
- **Settings dropdown** — `@radix-ui/react-dropdown-menu`, lucide
  `Settings2` icon trigger, ghost-button style. Items, in order:
  - **Rename room** (kept here as an alternate path to inline edit;
    triggers the inline-edit mode by setting a focus signal in the
    TopBar — does not open a modal)
  - **Theme** (sub-menu: System / Light / Dark; reuses the prefs
    store)
  - **Copy invite link** (same action as Share button; here for
    discoverability)
  - **Sign out**

  Items deliberately omitted from the prototype's dropdown:
  *Permissions* (no per-user role UI in MVP), *Compact density* (no
  density mode in MVP), *Leave room* (no member-management endpoints
  in MVP — owners delete the room; non-owners can't leave on the
  server side).

The TopBar's **avatar dropdown** still exists in dashboard config but
is replaced by the **settings dropdown** in room config (the user's
own avatar is just one of the presence stack pips when in a room).
Sign-out lives in both dropdowns for consistency.

### Slug generation

`apps/server/src/rooms/slug.ts` wraps `unique-names-generator` with
`adjectives` + `animals` dictionaries plus a numeric suffix from
`NumberDictionary.generate({ length: 2 })`, joined with `-` and
lowercased. Generates e.g. `wispy-falcon-42`. On Postgres unique-violation
(`rooms_slug_unique`), retry up to 5 times. On the 6th attempt, append a
4-char UUID fragment as a safety net.

```ts
import { uniqueNamesGenerator, adjectives, animals, NumberDictionary } from "unique-names-generator";

const numbers = NumberDictionary.generate({ length: 2 });
function generateSlug() {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals, numbers],
    separator: "-",
    style: "lowerCase",
  });
}
```

### Soft delete cascade

Soft delete sets `rooms.deleted_at = now()`. All queries filter
`WHERE deleted_at IS NULL` via Drizzle helper functions. `room_members` and
`room_invites` rows are left in place — fully reversible if a future restore
endpoint is added. Members of a soft-deleted room see it disappear from
their `GET /api/rooms` results because the JOIN filters on `deleted_at`.

### WebSocket re-auth strategy

(Implemented in `realtime-markdown`, declared here so the auth listener is in
`apps/web/src/lib/auth.ts` from this phase.)

The web client subscribes to `supabase.auth.onAuthStateChange`. On
`TOKEN_REFRESHED`, any active `HocuspocusProvider` is destroyed and
re-instantiated with the new JWT. **The in-memory Y.Doc instance survives
the reconnect** — only the provider is rebuilt. This is critical: any
local edits made during the token refresh window stay in the Y.Doc and
broadcast on reconnect. See `realtime-markdown.md` "Editor (client)" for
the implementation. Yjs's sync protocol re-syncs in ~50ms with no visible
state loss. Hocuspocus's `onAuthenticate` runs once per connection — no
in-band refresh needed.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| JWT verification | Asymmetric JWKS via `jose` | Stateless server; no shared secret; matches Supabase's modern asymmetric key model; 10-minute JWKS cache means zero hot-path network calls |
| OAuth flow | PKCE with `/auth/callback` route | 2026 default for SPAs; Supabase's recommended path; doesn't need a backend session endpoint |
| Slug source | `unique-names-generator` package | Friendly output, configurable, low maintenance; bundle size is server-only and trivial |
| API style | REST under `/api/rooms` with 8 endpoints | Idiomatic; auto-join folded into `GET /api/rooms/:slug` to avoid a second round-trip per visit |
| Validation | Zod schemas in `packages/protocol` + `fastify-type-provider-zod@^4` (Fastify v5 compat) | Single source of truth for client and server; `packages/protocol` finally has a real consumer |
| Error model | Single `{ error: { code, message, details? } }` envelope; typed `ErrorCode` union | Consistent client handling; codes machine-readable, messages human-readable |
| Auth guards | `_authed` pathless layout with `beforeLoad` | Zero render flicker; type-safe `next` param; one place to gate every authed route |
| WS re-auth | Reconnect on Supabase `TOKEN_REFRESHED` | Simplest path; `onAuthenticate` runs once per connection; ~50ms reconnect is invisible |
| Soft delete cascade | Filter at query time; leave rows untouched | Fully reversible; preserves audit trail; matches SPEC.md's soft-delete intent |
| Invite resolution trigger | On every `GET /api/rooms/:slug`; also surfaced in `GET /api/rooms` | One code path; users discover pending invites in their dashboard without an extra endpoint |
| First shadcn components | Button, Input, Label, Avatar, DropdownMenu, Dialog, AlertDialog, Sonner, Skeleton, Tooltip, Popover | Every component has a concrete consumer in this phase or in realtime-markdown; Tooltip is required for presence-avatar hovers, Popover is required for the inline-rename / share-confirmation surfaces and the tab `+` button menu |
| Room rename UX | Inline only (no modal) on both dashboard cards and TopBar room title | Matches the prototype; one interaction pattern across both surfaces |
| Email storage | Lowercased at write, lowercased on JWT read | Index-friendly case-insensitive matching |
| Member-management endpoints | Out of scope | No leave / kick / owner transfer; only owner can soft-delete the room |

## Rejected Alternatives

- **HS256 JWT verification with the Supabase project secret** — works, but
  the secret is a long-lived credential that can forge any user's token.
  Asymmetric is the modern path Supabase pushes new projects toward.
- **Supabase server SDK `auth.getUser()` per request** — adds a network
  round-trip on every HTTP and WS event. Wasteful when local JWT verification
  is trivial.
- **Implicit OAuth flow with hash fragment** — older pattern; PKCE is the
  default in `@supabase/supabase-js` v2 and safer.
- **Server-mediated session with httpOnly cookie (BFF)** — more secure for
  multi-client apps but adds Fastify session endpoints and a different auth
  model than Supabase's recommended SPA pattern. Overkill for our scope.
- **`friendly-words` package** — fewer customization knobs; fixed two-word
  format without a numeric suffix. Less playful than `unique-names-generator`.
- **Custom curated word list** — total control but maintenance cost; nothing
  about Rumi's tone needs hand-curation yet.
- **Skip PATCH for MVP** — simpler now but forces a migration when the room
  settings UI is built, and breaks the "owners can change visibility" promise
  of Pattern B from day one.
- **Separate `POST /api/rooms/:slug/join` endpoint** — explicit but doubles
  the round-trip on every room visit for no behavioral gain.
- **Component-level auth guards (`<RequireAuth>`)** — works but causes a
  render flash before redirect; you have to remember to wrap every new route.
- **In-band JWT refresh message over WebSocket** — saves a 50ms reconnect at
  the cost of custom protocol surface, mutable server-side auth state, and a
  new failure mode (refresh dropped → server thinks token still valid).
- **Defer WS re-auth** — leaves users with all-day-open tabs disconnected
  after one hour. Unacceptable for a real-time tool.
- **Mark pending invites as `accepted_at = now()` on soft delete** — lies
  about state; misuses the column.
- **Hard-delete invites on soft delete** — inconsistent (why drop invites
  but keep members?), irreversible.
- **Background sweep endpoint for invite resolution on sign-in** — adds an
  endpoint that's easy to forget on certain flows; resolution-on-fetch is
  simpler and covers every entry point.
- **`packages/ui` workspace from this phase** — premature; one consumer
  (`apps/web`) and no `apps/mobile` planned. Reassess when there's a second
  consumer.

## Edge Cases & Constraints

- **Email case mismatch.** Both writes and JWT reads lowercase the email.
  Index stays usable. Mismatched-case invites still resolve.
- **Email change after invite.** If a user changes their Supabase email,
  pending invites for the old email never resolve. Acknowledged in SPEC.md;
  invite resolution is best-effort.
- **Owner inviting an existing member (including themselves).** `POST` to
  invites does not pre-check membership. The invite is created and stays
  pending forever; resolution-on-fetch is a no-op because `INSERT INTO
  room_members ON CONFLICT DO NOTHING` matches the existing member row.
  Cosmetic but harmless. UI can dedupe by checking the room's member list
  before showing the invite as "pending."
- **Duplicate invite to same email.** Idempotent: returns the existing
  pending row.
- **Slug collision on create.** Retry up to 5x; 6th attempt appends a UUID
  fragment. Effectively unreachable at MVP scale.
- **Soft-deleted room in member's dashboard.** All queries filter
  `deleted_at IS NULL`; the room vanishes immediately from `GET /api/rooms`.
- **Race: two unjoined users hit a `link` room simultaneously.**
  `INSERT ... ON CONFLICT (room_id, user_id) DO NOTHING` handles it.
  Postgres serializes; both succeed.
- **Race: invite resolution.** `INSERT ... ON CONFLICT DO NOTHING` on the
  member; the `accepted_at` stamp is best-effort
  (`UPDATE ... WHERE accepted_at IS NULL`).
- **Owner deleting own membership.** Not possible via the API. Owner can
  only soft-delete the room. Member-management endpoints are post-MVP.
- **Sign-out while in a room.** `lib/auth.ts` listens for `SIGNED_OUT`,
  calls `router.invalidate()`, and the next `_authed.beforeLoad` redirects
  to `/sign-in`.
- **Visibility switched from `link` to `private` mid-session.** Existing
  members keep access (they're already in `room_members`). New visitors
  without an invite get 403. Existing members stay.
- **`link_can_edit=false` UI hint vs server enforcement.** The client uses
  the response field to render read-only mode, but the truth is enforced by
  Hocuspocus in `realtime-markdown`. Auth-and-rooms tests cover the field
  being returned correctly; full enforcement tests live in the later phase.
- **PATCH-vs-onAuthenticate race.** Owner PATCHes `linkCanEdit: false`
  while a non-owner is mid-`onAuthenticate`. The non-owner reads the room
  before the PATCH commits, gets `readOnly: false`, can briefly edit. Race
  window is bounded by the time between room-fetch and member-fetch in
  `onAuthenticate` (single-digit ms typical). Self-healing: PATCH's
  `dropRoomConnections` side effect drops the stale connection;
  reconnect reads the fresh value. Documented; acceptable.

## Testing

All server tests use mocked Drizzle — no real DB connection during
`bun test`. A thin repository layer in `apps/server/src/rooms/service.ts`
takes the Drizzle client as an injected dependency rather than importing
it directly; tests substitute a mock client. Manual verification (the
9-step flow at the end of `realtime-markdown.md`) is the integration
safety net for SQL and transaction semantics.

- `auth/verify.ts` — mocked JWKS endpoint via `jose`'s injectable
  resolver; cases for valid token, expired, wrong audience, missing
  email claim.
- `rooms/slug.ts` — collision retry with mocked unique-violation;
  6th-attempt UUID-fragment fallback.
- `rooms/service.ts` — owner-bootstrap atomicity, auto-join on
  `link` rooms, invite resolution, soft-delete filtering. Repo
  mocked.
- `extractProfile()` — fixtures for GitHub and Google `user_metadata`
  shapes plus the email-prefix fallback.
- HTTP route tests — Fastify's `app.inject()` with the auth plugin
  enabled, a mocked repo, and a mocked `dropRoomConnections` decorator;
  covers status codes, error envelopes, ownership checks, *and* the
  `dropRoomConnections` side effect:
  - PATCH with `name`-only change → `dropRoomConnections` not called.
  - PATCH with `visibility` or `linkCanEdit` change →
    `dropRoomConnections(roomId)` called exactly once after the DB write.
  - DELETE → `dropRoomConnections(roomId)` called exactly once.
- Web smoke tests — `lib/api.ts` with `fetch` mocked (including the
  401-refresh-retry path); `_authed` `beforeLoad` with mocked session.

If a SQL bug ever bites that mocking would have missed, the recovery is:
spin up a `rumi-test` Supabase project and add a targeted integration
test for the specific case. We don't pre-build that infrastructure.

## Open Questions

None. SPEC.md's open questions on WS re-auth (resolved: reconnect),
slug source (resolved: `unique-names-generator`), and cascading invite
cleanup (resolved: query-time filter) are all answered here. Remaining
SPEC.md items (settings UI surface, migration strategy if room model
changes) are out of scope for this phase.

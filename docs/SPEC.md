# Rumi — System Specification

> **In-flight designs.** Some feature designs are described in
> `docs/designs/*.md` and have not yet been merged into this spec.
> Always check that directory for the most current design before
> implementing — design docs win over SPEC.md when they disagree until
> sync-docs reconciles. As of writing: `design-system.md`,
> `auth-and-rooms.md`, `realtime-markdown.md`, and `drawing.md` are in
> flight. SPEC.md has been partially updated (data model, key decisions,
> non-goals) to reflect the tab system pivot, but UI-detail and CRUD
> behavior live in the design docs and plans.

## Vision

Rumi is a real-time, multi-user collaborative workspace for developers. It enables
multiple participants to work simultaneously inside shared rooms with a unified,
state-synchronized document. The system is state-driven, not request/response —
edits propagate continuously and converge automatically across all clients.

## Goals

- Multiple users edit shared content in real time with sub-200ms perceived
  remote-edit latency and instant local-edit feel
- Per room, up to 3 tabs (free tier) of two kinds:
  - **Tab** — a unified text editor that can be set to plain text, any code
    language (syntax highlighted), or markdown (with a toolbar and a 3-way
    view-mode toggle: split, rendered-only, source-only)
  - **Drawing** — a collaborative whiteboard powered by tldraw
- Conflict-free, eventually-consistent collaboration with no manual merge UI,
  per tab
- Authenticated, room-scoped access control via OAuth
- Per-room visibility control (private vs link-shared) and a single edit-permission
  toggle (`link_can_edit`) — no per-user roles beyond owner/member
- Owner-managed invitations for private rooms (by Supabase email) before the
  invitee has signed up
- User-changeable preferences for theme, UI font, and editor font (client-side
  persistence)
- Durable persistence with at-most ~10 seconds of data-loss risk per tab
- Developer-first aesthetic — plain-text editing surfaces with syntax
  highlighting, plus a markdown preview when the tab is set to markdown

## Non-Goals (MVP)

- More than 3 tabs per room — the cap is the gate for a future paid tier;
  pricing/subscription/upgrade plumbing is post-MVP
- Cursor awareness in the editor (deferred)
- Full version history / time-travel
- Per-user roles beyond owner/member (no editor/viewer/admin distinction)
- Public room directory / discovery — `visibility: "public"` is not a value
- Server-synced user preferences — settings live in the browser only for MVP
- Anonymous / guest access — sign-in is required
- Offline-first / local-first behavior
- Email/password auth, magic links, account recovery flows
- Hard delete of rooms — deletion is soft (`deleted_at`)
- Owner transfer
- Multi-region / multi-instance scaling (single-instance MVP)
- Drag-to-reorder tabs (out of scope for MVP; tabs render in creation order)
- Mobile-specific UI work — phone is best-effort via Tailwind responsive
  utilities; no mobile toolbar, no touch-optimized controls. Tablet/iPad gets
  sensible adaptive layout because the drawing tab is part of MVP.
  See "Responsive scope" below.

## Responsive scope

| Tier | Width | Treatment |
|---|---|---|
| Desktop | ≥ 1024px | First-class. All design work targets this. |
| Tablet / iPad | 768–1023px | Supported. Layout adapts via Tailwind responsive utilities (`md:`/`lg:` breakpoints). Tab and drawing surfaces work comfortably with stylus/touch; tldraw handles its own touch/stylus input on the drawing tab. |
| Phone | < 768px | Best-effort. Single-column stacking; dialogs full-screen. Markdown editor falls back to single-pane source even when split is selected. No mobile toolbar, no touch-optimized markdown controls. Things shouldn't break, but no specific polish. |

No "use a desktop" banners or redirects. Components are designed to not
actively break at any width.

## Architecture

Rumi is a TypeScript monorepo with three workspaces: a React web client, a Bun +
Fastify backend, and a shared protocol package. Real-time sync uses Yjs CRDTs
relayed through Hocuspocus. Document state is persisted to Postgres (hosted on
Supabase). Auth is OAuth-only via Supabase Auth.

The backend is a single stateful Node-compatible process that holds active Yjs
documents in memory while clients are connected, and persists snapshots to
Postgres on a debounce. There is no horizontal scale tier in MVP — one server
instance owns all rooms.

### Repository Layout

```
rumi/
├── apps/
│   ├── web/          # Vite + React + TypeScript client
│   └── server/       # Bun + Fastify + Hocuspocus server
├── packages/
│   └── protocol/     # Shared types, Zod schemas, message protocol
├── docs/
│   ├── SPEC.md
│   └── designs/
├── biome.json
├── package.json      # Bun workspace root
├── tsconfig.base.json
└── bun.lockb
```

### Backend module structure (`apps/server/src/`)

Organized by feature, not by layer:

- `rooms/` — room lifecycle, metadata, membership
- `sync/` — Hocuspocus integration, WebSocket upgrade
- `presence/` — ephemeral user presence broadcast
- `persistence/` — Yjs document snapshot writes (Hocuspocus DB extension)
- `auth/` — Supabase JWT validation, route guards
- `lib/` — logger, env loader, error types
- `db/` — Drizzle schema, migrations, client
- `server.ts` — wiring

### Key Components

- **Web client** (`apps/web`) — React + Vite SPA. The room view is a tab
  bar above a per-tab editor surface:
  - **Tab** — CodeMirror 6 bound to a Yjs `Y.Text` per tab via
    `y-codemirror.next`. Language is a per-tab property; switching language
    swaps the language extension. When language = `markdown`, a toolbar
    renders above the editor and a view-mode toggle cycles through split
    (source + rendered preview), rendered-only, and source-only.
    Code-block syntax highlighting (inside markdown and inside any non-
    markdown language tab) uses Shiki.
  - **Drawing** — tldraw, bound to a Yjs `Y.Map` per tab via tldraw's
    Yjs adapter (default tldraw chrome and toolset).
  - Connects to the server via `@hocuspocus/provider` over WebSocket
    (one provider per room, multiple Yjs sub-documents per tab). Auth
    via `@supabase/supabase-js`.
- **Server** (`apps/server`) — Fastify HTTP for room/tab CRUD and
  auth-protected endpoints; Hocuspocus for WebSocket sync. Validates
  Supabase JWTs on both HTTP and WebSocket connection (`onAuthenticate`
  hook).
- **Protocol** (`packages/protocol`) — Zod schemas for HTTP request/response
  shapes, tab metadata (`type`, `language`, etc.), presence payload shape,
  and any custom WS message types beyond Hocuspocus's protocol. Imported
  by both web and server.
- **Postgres (Supabase)** — stores Yjs document binary state (one row per
  *tab*, via the `@hocuspocus/extension-database` extension wired to our
  Drizzle-managed `tab_documents` table) and application metadata (rooms,
  tabs, memberships, invites) managed via Drizzle. **Cloud Supabase is the
  only Postgres in MVP** — there is no local Docker Postgres. Each developer
  uses their own Supabase project (free tier) for dev. This eliminates
  the dual-DB mental split that arises when local app data lives separate
  from cloud `auth.users`.
- **Supabase Auth** — OAuth providers: GitHub, Google. Issues JWTs the server
  validates. No email/password; no magic links.

### Data Flow

**Edit propagation (steady state):**

1. User types in a tab (CodeMirror) or draws on a drawing tab (tldraw).
2. The local Yjs sub-document for that tab applies the edit; UI updates
   instantly (~0ms perceived latency).
3. The Yjs update is encoded and sent over WebSocket via `@hocuspocus/provider`,
   tagged with the tab's stable id.
4. The server's Hocuspocus instance applies the update to its in-memory copy
   of the tab's document and broadcasts it to all other connected clients in the room.
5. Other clients apply the update; their editors / canvases reflect the change.
6. Hocuspocus's persistence extension debounces and writes the document state
   to Postgres (every 2s of idle, max 10s), per tab.

**Room join:**

1. Client requests `GET /api/rooms/:slug` with Supabase JWT in `Authorization`.
2. Server validates JWT, checks membership, returns room metadata + the tab
   list (id, name, type, language, ordinal) for that room.
3. Client opens a WebSocket connection to Hocuspocus with the same JWT.
4. Hocuspocus `onAuthenticate` hook validates the JWT and authorizes the room.
5. For each tab the user opens, the client subscribes to that tab's Yjs
   sub-document; the server loads the latest state from Postgres (or
   initializes empty) and syncs it to the client.
6. Client begins broadcasting presence; server relays presence to the room.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo layout | Bun workspaces monorepo (`apps/*`, `packages/*`) | Industry default for real-time collab projects; shared types between client and server are first-class |
| Backend organization | Feature-scoped modules, not layered | Matches the shape of the problem (small domain, mostly sync + persistence). Layered/hexagonal is ceremony with no payoff here |
| Runtime | Bun | Fast startup, native TS, native SQLite, native `.env`, zero-config test runner |
| Backend framework | Fastify | Modern Express replacement; first-class TS, schema validation, plugin ecosystem, built-in Pino logging |
| Realtime sync engine | Hocuspocus + Yjs | Production-grade Yjs server. Solves sync, awareness, persistence hooks, auth hooks out of the box |
| Validation | Zod | Industry default for runtime TS schemas; reused for HTTP, WS protocol, env vars |
| Persistence DB | Postgres on Supabase | Production-grade from day one; managed hosting eliminates DB ops; auth in same product |
| ORM | Drizzle + drizzle-kit | TS-native, SQL-shaped, no codegen step, first-class Bun support |
| Auth | Supabase Auth, OAuth-only (GitHub + Google) | Eliminates email infrastructure entirely; matches developer audience; required for all access |
| Anonymous access | Not supported | Simpler model; every connection has a real identity |
| Frontend build | Vite + React + TypeScript | Modern default; fast HMR; good TS story |
| Tab editor | CodeMirror 6 + `y-codemirror.next` for the unified Tab type (text/code/markdown) | One editor with per-tab language; markdown is just `language=markdown` with a toolbar + preview overlay; code is any non-markdown language with Shiki highlighting; plain text is no language. Avoids maintaining separate editor stacks. |
| Code-block syntax highlighting | Shiki | VS Code's TextMate grammars; ~150 languages; same renderer used inside markdown fenced code blocks and inside non-markdown Tab languages, so highlighting is consistent across surfaces |
| Drawing surface | tldraw + Yjs adapter | Production-grade collaborative whiteboard; built-in toolbar/tools/undo/redo; Yjs sync is first-class |
| Tabs per room (free tier) | Hard cap 3 | Free-tier gate; the cap is the seam where future paid plans unlock more. Pricing/upgrade plumbing is post-MVP. |
| Tab type model | Discriminated by `type`: `tab` (text/code/markdown via language) or `drawing` | Two surfaces, one tab list. Adding a tab opens a popover that lets the user pick the type; type is immutable after creation, language is mutable for `tab`-type rows. |
| Markdown view modes | Per-tab toggle: split (default) → rendered-only → source-only | Cycles via a single toolbar button. Setting is per-tab and per-session (does not persist across reloads or sync across users). |
| Markdown rendering | Server-safe markdown library (CommonMark + GFM: tables, task lists, strikethrough) for the preview pane; sanitized via `rehype-sanitize` or equivalent | Free upgrade beyond the Lovable prototype's hand-rolled renderer; tables and task lists ship by default. Sanitizer removes any HTML the user pastes. |
| Markdown shortcuts | Cmd/Ctrl+B, Cmd/Ctrl+I, Cmd/Ctrl+K (link) wrap selection via custom CodeMirror commands | Standard editor expectation; the same actions are also exposed as toolbar buttons |
| Yjs client transport | `@hocuspocus/provider` | Matches the server; handles reconnection and resync automatically |
| Frontend state | Zustand | Right-sized for app-level UI state (most data lives in Yjs doc, not Zustand) |
| Routing | TanStack Router | Fully type-safe routes; modern |
| Styling | Tailwind v4 | 2026 default; native CSS engine; pairs well with shadcn/ui later |
| Linting/formatting | Biome | Single tool replaces ESLint + Prettier; fast |
| Testing | `bun test` | Built into the runtime; Jest-compatible API; zero config |
| Logging | Pino (built-in to Fastify) + `pino-pretty` for dev | Modern structured logging; replaces winston |
| Security | `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` | Fastify-native equivalents of the previous stack |
| Dropped from prior starter | morgan, winston, compression, custom requestId middleware | Replaced by Fastify built-ins or unnecessary at MVP scale |
| Room ID format | Short word-slug (e.g., `wispy-falcon-42`) | Shareable, human-readable, low collision at MVP scale |
| Snapshot cadence | Hocuspocus defaults: 2s debounce, 10s max wait | Bounds data-loss to ~10s while minimizing DB writes |
| Presence shape | `{ user_id, display_name, avatar_url, color }` | `user_id` and `color` stamped server-side from the verified JWT (clients can't spoof identity); `display_name` and `avatar_url` are client-supplied cosmetic fields; cursor position deferred |
| Permissions model | Pattern B: room `visibility` (`private` \| `link`) + `link_can_edit` boolean; single `owner` role on top of `member` | Matches "Figma/Tldraw-style" sharing; per-user roles add schema and UI cost without clear MVP value |
| Link semantics | Open-link auto-join: any signed-in user with a `visibility=link` room URL is added to `room_members` on first connect | Frictionless sharing matches the product's collaborative spirit; private rooms remain strictly invite-gated |
| Invites | `room_invites` table tracks pending invites by email; resolved to `room_members` when the invitee signs in or visits the room | Lets owners invite users who don't yet have a Supabase account |
| User preferences storage | Client-only (Zustand + `localStorage`) for MVP; no DB sync | Avoids a `user_preferences` table and a settings sync round-trip; revisit when multi-device pref sync is needed |
| UI font | Lato via `@fontsource-variable/lato` (default); user-changeable from a curated list | Warm, humanist sans; user can switch to Inter, system-ui, etc. via Settings |
| Editor font | Geist Mono via the `geist` package (default); user-changeable from a curated list | Modern monospace; user can switch to JetBrains Mono, Fira Code, etc. via Settings |
| Default theme | Dark mode default; toggle via `next-themes`; respects system preference on first visit | User preference; light remains a first-class option |
| Soft delete | `rooms.deleted_at` timestamp; rooms are filtered out of queries when set | Preserves CRDT data and audit trail; hard delete is a separate post-MVP concern |
| Invite identifier | Email-only; no username system | Email is universal, matches every OAuth provider's primary identifier, and avoids a `usernames` table + claim/transfer flows. Modern collab tools (Linear, Figma, Notion) invite by email even when they have usernames. |
| Settings UI surface | Dedicated `/settings` route (TanStack Router) | Route-based settings scale to multiple sub-sections without re-architecting; URL-shareable settings deep-links come free. Modal/drawer would force a refactor when settings grows past a few toggles. |
| Room model migrations | None planned for MVP | Document persistence is keyed on `tab_id` UUID, so slug renames and (future) owner transfers are pure metadata updates with no migration burden. Revisit if/when a real migration becomes necessary. |
| Deployment | Deferred until deploy time | Server requires stateful Node-compatible host; web client is static SPA. Fly.io/Railway/VPS for server, Vercel/Netlify for web |

## Data Model

### Database tables (managed by Drizzle)

**`rooms`**
- `id` — UUID, primary key
- `slug` — text, unique (the shareable room identifier, e.g., `wispy-falcon-42`)
- `name` — text, optional display name
- `owner_id` — UUID, references the Supabase user that created the room
- `visibility` — text, one of `'private' | 'link'`, default `'link'`
- `link_can_edit` — boolean, default `true`. Only meaningful when
  `visibility = 'link'`; controls whether non-owner members can edit
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable. Set on soft delete; rooms with a non-null
  value are filtered from all queries

**`room_members`**
- `room_id` — UUID, references `rooms.id`
- `user_id` — UUID, Supabase user
- `role` — text, one of `'owner' | 'member'`. Exactly one row per room has
  `role='owner'`
- `joined_at` — timestamp
- Primary key: `(room_id, user_id)`

**`room_invites`**
- `id` — UUID, primary key
- `room_id` — UUID, references `rooms.id`
- `invited_email` — text. The email used to invite; matched against the
  authenticated user's JWT email on every `GET /api/rooms` and
  `GET /api/rooms/:slug` call. Resolution is on-fetch, not on-sign-in
- `invited_by` — UUID, the inviting user
- `created_at` — timestamp
- `accepted_at` — timestamp, nullable. Set when the invitee is promoted to
  `room_members`
- Indexed on `(invited_email, room_id)` for lookup

**`tabs`**
- `id` — UUID, primary key (the stable id used as the Hocuspocus document
  name and as the persistence key for `tab_documents`)
- `room_id` — UUID, references `rooms.id` with `ON DELETE CASCADE`
- `type` — text, one of `'tab' | 'drawing'`. Discriminator for which
  editor renders the tab and which Yjs shape lives inside the document.
- `language` — text, nullable. Only meaningful when `type='tab'`. Values
  are short identifiers from a fixed registry (e.g. `markdown`, `typescript`,
  `python`, `go`, `null` = plain text). Mutable; switching does not migrate
  content.
- `name` — text. User-editable display label; trimmed, max 100 chars; falls
  back to `"Untitled"` when blank.
- `ordinal` — integer. Position in the tab strip; the server keeps these
  contiguous on insert/delete. Reorder is post-MVP.
- `created_at` — timestamp
- `updated_at` — timestamp
- Index on `(room_id, ordinal)`
- A `CHECK` constraint enforces that `language IS NULL` when `type='drawing'`.

Owners (and any member when `link_can_edit=true`) can create/rename/delete
tabs. The 3-tab cap is enforced server-side at insert time; any client that
tries to exceed it gets a `tab_limit_reached` error.

### Document persistence

A Drizzle-managed `tab_documents` table stores Yjs binary state, one row
per tab (PK `tab_id`, `state` bytea, `updated_at`). The Hocuspocus
`@hocuspocus/extension-database` extension is configured with our
`fetchDocument(tabId)` and `storeDocument(tabId, state)` callbacks; the
extension itself does not own the schema. Persistence keys on the stable
`tab_id` UUID, not the room slug. Hocuspocus's `documentName` is the tab
id; the server resolves `tab_id → room_id` once per connection in
`onAuthenticate` so room-level permission checks still apply.

### Ephemeral state (not persisted)

**Presence** — broadcast over WebSocket via Yjs awareness protocol; never
written to Postgres:
- `user_id` — stamped server-side from the verified JWT context (clients
  cannot spoof identity)
- `color` — deterministic hash of `user_id`, also stamped server-side
- `display_name` — client-supplied, cosmetic
- `avatar_url` — client-supplied, cosmetic

### Client-only state

**User preferences** — stored in `localStorage` via a Zustand store; never
synced to the server in MVP:
- `theme` — `'light' | 'dark' | 'system'`, default `'dark'`
- `ui_font` — string identifier from a curated list (default: `'lato'`)
- `editor_font` — string identifier from a curated list (default:
  `'geist-mono'`)

A future `user_preferences` table would replace this; explicitly out of scope
for MVP.

## Edge Cases & Constraints

- **Server is stateful.** Active Yjs documents live in the Hocuspocus instance's
  memory. Restarting the server drops in-memory state but does not lose data —
  clients reconnect and Hocuspocus reloads from Postgres. The window between
  the last persisted snapshot and a crash is the data-loss boundary (~10s max).
- **Single-instance MVP.** Two server instances cannot share rooms without a
  coordination layer (Redis pub/sub, or Hocuspocus's Redis extension). Out of
  scope for MVP; documented as a known scaling boundary.
- **Reconnection.** `@hocuspocus/provider` handles automatic reconnection with
  exponential backoff. State resyncs via the Yjs sync protocol on reconnect.
- **Auth token expiry.** Supabase JWTs expire (default 1 hour). The web client
  refreshes via `@supabase/supabase-js`. On `TOKEN_REFRESHED`, the
  `HocuspocusProvider` is destroyed and re-instantiated with the new JWT;
  the in-memory Y.Doc survives the reconnect so unsaved local edits aren't
  lost. Yjs sync protocol re-syncs in ~50ms with no visible state loss.
- **Slug collisions.** Word-slug generation must check against existing slugs
  and retry on collision. Deterministic; collision rate is low but nonzero.
- **Yjs document size.** Persistence uses `Y.encodeStateAsUpdate`, a
  compacted state-vector form (not an event log). Each save replaces the
  row with a fresh compacted state, so document size in storage is bounded
  by current content rather than edit history. The in-memory Y.Doc still
  accumulates internal CRDT structure over its lifetime; Yjs's own GC
  handles cleanup. Worth monitoring at scale, not a hot concern at MVP.
- **Room membership semantics.**
  - `visibility = 'link'`: any authenticated user who hits the room URL is
    auto-added to `room_members` with `role='member'` on first connect.
  - `visibility = 'private'`: only existing `room_members` and users with a
    matching pending `room_invites.invited_email` can enter. Invitees are
    promoted from `room_invites` to `room_members` on first successful join.
  - Owners are bootstrapped at room creation: the creator's row is inserted
    with `role='owner'` in the same transaction as the `rooms` row.
- **Edit permission semantics.** When `link_can_edit = false` and
  `visibility = 'link'`, non-owner members can join and view but receive a
  read-only Yjs document handle; the server rejects update messages from
  non-owners. When `link_can_edit = true` (default), all members can edit.
  In `visibility = 'private'`, `link_can_edit` is ignored — all members can
  edit.
- **Permission revocation propagation.** PATCH `/api/rooms/:slug` (when
  `visibility` or `link_can_edit` change) and DELETE `/api/rooms/:slug`
  call `dropRoomConnections(roomId)` after the DB write commits — a
  helper that iterates every tab connection in the room and the room's
  control-doc connection, calling `hocuspocus.closeConnections(name)` on
  each. Live WS connections drop and reconnect; `onAuthenticate`
  re-evaluates membership and `readOnly` against the fresh row, per
  tab. Tab-level mutations (PATCH name/language, DELETE tab) call
  `closeTabConnections(tabId)` for the single affected tab. Without
  this, owners could not effectively revoke edit access without waiting
  up to JWT TTL (1hr) for a natural reconnect.
- **Invite resolution.** `room_invites.invited_email` is matched
  case-insensitively against the JWT's email claim. Mismatched cases or
  changed emails won't auto-resolve; the invite stays pending. Resolution is
  best-effort, not authoritative.
- **Soft delete.** `rooms.deleted_at` is set on delete; CRDT state and member
  rows remain. Restoration is a manual DB operation in MVP; a restore endpoint
  is post-MVP.
- **Performance target.** Local edits feel instant; remote edits propagate
  within 200ms typical (network-bound; Hocuspocus's relay is sub-ms).
- **Tab cap enforcement.** The 3-tab limit is enforced server-side at
  `POST /api/rooms/:slug/tabs`. Concurrent inserts under the cap are
  serialized via the Postgres unique index on `(room_id, ordinal)` plus
  a `SELECT count(*) FROM tabs WHERE room_id = $1` inside the same
  transaction; the loser retries or returns `tab_limit_reached`. The
  client also disables the `+` button at 3 tabs and shows an upgrade
  hint, but server enforcement is the source of truth.
- **Tab language switch.** Setting `language` on a `type='tab'` row is a
  cheap metadata update — the underlying Y.Text content is not migrated
  or re-tokenized server-side. Clients reload the language extension and
  Shiki highlighter for that tab. Markdown ↔ non-markdown switches also
  show/hide the markdown toolbar and view-mode toggle.
- **First tab seed content.** When a brand-new room is created, the server
  inserts a single `type='tab'`, `language='markdown'` tab named
  `"Welcome"` — but only the *row*, not the Yjs binary content. The
  client recognizes a tab named `"Welcome"` with `language='markdown'`
  and an empty `Y.Text` on first connect and inserts the welcome content
  into the Y.Text locally; CRDT semantics make subsequent re-syncs
  no-op (`Y.Text` is non-empty after the first insert wins). Keeping
  the server out of Yjs encoding avoids binary-format coupling between
  the API and the realtime layer. Subsequent user-created tabs start
  empty — the seed is a one-time first-room gesture.
- **Drawing tab persistence.** tldraw's Yjs adapter writes its document
  shape into a `Y.Map` inside the per-tab Y.Doc. The same
  `tab_documents.state` bytea column stores the encoded Y.Doc; no
  schema change between tab types.

## Open Questions

None.

## References

- [Yjs](https://github.com/yjs/yjs) — CRDT library
- [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) — Yjs server
- [Fastify](https://fastify.dev) — backend framework
- [Drizzle ORM](https://orm.drizzle.team) — TypeScript ORM
- [Supabase](https://supabase.com) — Postgres + Auth
- [CodeMirror 6](https://codemirror.net) — editor
- [TanStack Router](https://tanstack.com/router)
- [Biome](https://biomejs.dev) — lint + format

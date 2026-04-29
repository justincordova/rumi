# Rumi — Agent Context

Real-time collaborative workspace for developers. Multi-user rooms with tabs
(markdown/code editor) and drawing boards (tldraw). TypeScript monorepo.

## Repo layout

```
rumi/
├── apps/
│   ├── web/          # Vite + React + TanStack Router SPA
│   └── server/       # Bun + Fastify + Hocuspocus
├── packages/
│   └── protocol/     # Shared Zod schemas (imported by both apps)
├── docs/
│   ├── SPEC.md       # Authoritative product spec
│   ├── TESTING.md    # Testing conventions and patterns
│   ├── LOGGING.md    # Logging conventions
│   └── designs/      # In-flight feature design docs (win over SPEC.md when they conflict)
├── biome.json
├── bunfig.toml       # Root: preloads test-setup.ts (env vars + happy-dom)
├── test-setup.ts     # Preloaded by bunfig.toml — sets env vars + happy-dom for all tests
```

## Commands

```bash
# From repo root
bun run dev:web          # Vite dev server (web)
bun run dev:server       # Fastify dev server (server)
bun run check            # Biome lint + format check
bun run format           # Biome autofix
bun run typecheck        # tsc -b (all workspaces)
bun test apps packages   # All tests

# Server only
bun --cwd apps/server run db:migrate   # Apply Drizzle migrations to Supabase
```

The pre-commit gate is: `bun run check` → `bun run typecheck` → `bun test apps
packages` → vite build. All must pass before committing.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Backend framework | Fastify + `fastify-type-provider-zod` |
| Realtime sync | Hocuspocus + Yjs |
| DB / Auth | Supabase (Postgres + OAuth) |
| ORM | Drizzle |
| Frontend build | Vite + React |
| Routing | TanStack Router |
| Styling | Tailwind v4 (`@theme` tokens in `globals.css`) |
| State | Zustand (app-level UI); Yjs (document state) |
| Editor | CodeMirror 6 + `y-codemirror.next` |
| Drawing | tldraw v4 + custom Yjs binding |
| Syntax highlight | Shiki (inside markdown fenced blocks + code tabs) |
| Lint / format | Biome (single tool; replaces ESLint + Prettier) |
| Tests | `bun test` (Jest-compatible) |
| Validation | Zod (HTTP, WS protocol, env vars) |

## Key architectural patterns

### WebSocket document naming

Hocuspocus `documentName` is either:
- A tab UUID — the per-tab Yjs sub-document
- `"room:<roomId>"` — the room control document (tab list, presence)

`onAuthenticate` in `apps/server/src/sync/authorize.ts` resolves the name to
`roomId` + optional `tabId`, checks membership, and sets `readOnly` on the
context.

### readOnly propagation

`onAuthenticate` sets `ctx.readOnly`. The `connected` hook (in
`apps/server/src/sync/hocuspocus.ts`) fires after auth + initial sync and calls
`connectionInstance.sendStateless(JSON.stringify({ type: "session", readOnly }))`.

On the client, `useTabDoc` and `useRoomControlDoc` parse `onStateless` payloads
to set the `readOnly` state, which flows into editors and tldraw.

### Tab list sync (control doc)

Tab metadata is kept in a `Y.Array<TabSummary>` inside the room control doc
(named `"room:<roomId>"`). The server mutates this array directly via
`h.openDirectConnection` after any CRUD operation on tabs (see
`apps/server/src/sync/control.ts`). The client reads it via `useTabs` in
`apps/web/src/components/tabs/use-tabs.ts`.

### Presence stamping

`user_id` and `color` are always overwritten server-side in
`onAwarenessUpdate` (hashed from the verified JWT). Clients may supply
`display_name` and `avatar_url` but cannot spoof identity fields.

### Permission revocation

After `PATCH /api/rooms/:slug` or `DELETE /api/rooms/:slug`, the server calls
`app.dropRoomConnections(roomId)` which closes all live WebSocket connections
for that room's tabs and control doc. This forces clients to reconnect, at which
point `onAuthenticate` re-evaluates the new permissions. For single-tab mutations
(PATCH/DELETE tab), it calls `app.closeTabConnections(tabId)`.

### Drawing (tldraw v4)

`createYjsStore` in `apps/web/src/lib/drawing/yjs-store.ts` creates a TLStore
and keeps it in sync with a `Y.Map<TLRecord>` named `"tldraw"` inside the tab's
Y.Doc. Bi-directional: local store changes write to the Y.Map (tagged as
`"local"` transaction), remote Y.Map changes (non-"local" transactions) are
applied to the store via `mergeRemoteChanges`.

## Server module structure (`apps/server/src/`)

```
auth/
  plugin.ts       — Fastify auth decorator; injects verified user into request
  verify.ts       — JWT verification via jose + JWKS
  jwks.ts         — JWKS URL fetcher / cacher
db/
  schema.ts       — Drizzle table definitions (rooms, room_members, room_invites, tabs, tab_documents)
  client.ts       — Drizzle db instance
  documents.ts    — fetchDocument / storeDocument (Yjs binary state)
lib/
  env.ts          — Zod-parsed env (PORT, DATABASE_URL, SUPABASE_*)
  errors.ts       — AppError, AuthError, envelope() helper
  logger.ts       — Pino instance
rooms/
  service.ts      — createRoom, listRooms, getRoomBySlug, updateRoom, softDeleteRoom, createInvite, listInvites, revokeInvite
  routes.ts       — HTTP routes for rooms + invites
  tabs.service.ts — listTabs, createTab (3-tab cap), updateTab, deleteTab (ordinal re-pack)
  tabs.routes.ts  — HTTP routes for tabs
  slug.ts         — Word-slug generator with collision retry
sync/
  hocuspocus.ts   — Server.configure: onAuthenticate, onAwarenessUpdate, onStoreDocument, connected (sendStateless), onDisconnect
  authorize.ts    — onAuthenticate implementation
  persistence.ts  — @hocuspocus/extension-database wired to fetchDocument/storeDocument
  presence.ts     — colorFor(userId) deterministic color hash
  control.ts      — broadcastTabsCreated/Updated/Deleted via openDirectConnection
server.ts         — Fastify app wiring; HTTP upgrade → Hocuspocus /ws
```

## Web module structure (`apps/web/src/`)

```
lib/
  auth.ts         — useSession (Zustand), initAuth, signInWithProvider, signOut, extractProfile
  api.ts          — apiFetch (sets Authorization header, handles 401 token refresh retry)
  supabase.ts     — Supabase client (PKCE flow)
  env.ts          — VITE_* env vars
  prefs.ts        — Zustand persist: theme, uiFont, editorFont
  fonts.ts        — Font registry + loader
  theme.tsx       — ThemeProvider (next-themes) + PrefsBridge
  utils.ts        — cn() (clsx + tailwind-merge)
  shiki.ts        — Shiki singleton (lazy-loaded)
  welcome-content.ts — Seed text injected into the first Welcome tab on empty Y.Text
  collab/
    awareness.ts  — buildLocalAwareness(user): LocalAwareness (display_name, avatar_url)
  markdown/
    languages.ts  — Language registry; lazy CodeMirror extensions
    render.ts     — unified/remark/rehype pipeline + rehype-sanitize
  drawing/
    yjs-store.ts  — createYjsStore: Y.Doc ↔ TLStore bi-directional binding
    theme.ts      — useTldrawTheme: maps prefs + next-themes to tldraw theme token
stores/
  rooms.ts        — Zustand rooms store (dashboard list, optimistic updates)
components/
  topbar.tsx      — TopBar: room name, status, PresenceAvatars, settings dropdown (rename, copy link)
  editor/
    use-tab-doc.ts         — HocuspocusProvider per tab; onStateless → setReadOnly
    use-room-control-doc.ts — HocuspocusProvider for "room:<id>"; same pattern
    tab-editor.tsx         — Dispatches to MarkdownTab / CodeTab / DrawingTab by tab.type + tab.language
    tab-cm.tsx             — CodeMirror 6 with Yjs binding + Compartments for hot-swap language
    markdown-tab.tsx       — Split/rendered/source modes; welcome seed on empty Y.Text
    code-tab.tsx           — tab-cm.tsx with language-specific extensions
    drawing-tab.tsx        — tldraw + createYjsStore + readOnly via editor.updateInstanceState
    markdown-toolbar.tsx   — 8 toolbar buttons + language picker + view-mode toggle
    markdown-preview.tsx   — Debounced Y.Text observer → Shiki-enhanced HTML
    presence-avatars.tsx   — Awareness states → overlapping avatar stack with +N overflow
    read-only-pill.tsx     — Badge shown when readOnly=true
    connection-status.tsx  — WS status indicator
    editor-skeleton.tsx    — Loading skeleton
  rooms/
    room-card.tsx, empty-state.tsx, create-room-dialog.tsx,
    delete-room-dialog.tsx, invite-dialog.tsx
  tabs/
    tab-bar.tsx       — Tab strip with active highlight
    add-tab-popover.tsx — Popover to pick tab type (text/drawing) then POST
    use-tabs.ts       — Y.Array<TabSummary> observer from the control doc
    tab-icons.ts      — Tab type → icon map
  ui/               — shadcn/ui primitives (button, input, dialog, dropdown-menu, etc.)
routes/
  __root.tsx            — ThemeProvider, Toaster, RouterProvider shell
  sign-in.tsx           — OAuth sign-in page (GitHub + Google)
  auth/callback.tsx     — PKCE callback handler
  _authed.tsx           — beforeLoad auth guard; redirects to /sign-in if anonymous
  _authed/
    index.tsx           — Dashboard (room list, create, delete)
    r.$slug.tsx         — Room page: TopBar + TabBar + TabEditor + ConnectionStatus
```

## Protocol package (`packages/protocol/src/`)

Zod schemas + explicit `export type` aliases for all of them (required by
`verbatimModuleSyntax`). Key exports:

- `Room`, `TabSummary`, `RoomInvite` — domain objects
- `CreateRoomBody`, `UpdateRoomBody`, `CreateTabBody`, `UpdateTabBody` — request shapes
- `GetRoomResponse`, `ListRoomsResponse`, `CreateRoomResponse`, etc. — response shapes
- `ErrorEnvelope`, `ErrorCode` — error wrapper shape
- `PROTOCOL_VERSION = "0.1.0"`

Always import with `import type { Foo }` at call sites. The schemas themselves
(not just types) are also exported for runtime validation.

## Database schema (Drizzle — `apps/server/src/db/schema.ts`)

| Table | PK | Notes |
|---|---|---|
| `rooms` | uuid | `slug` unique; `deleted_at` for soft delete; `visibility: 'private'|'link'`; `link_can_edit: bool` |
| `room_members` | (room_id, user_id) | `role: 'owner'|'member'` |
| `room_invites` | uuid | `invited_email` matched case-insensitively; `accepted_at` nullable |
| `tabs` | uuid | `type: 'tab'|'drawing'`; `language` nullable; `ordinal` contiguous int; CHECK: drawing → language IS NULL |
| `tab_documents` | tab_id (FK → tabs) | `state bytea` — encoded Yjs state snapshot |

## Env vars

See `apps/server/.env.example` and `apps/web/.env.example`. Server env vars are validated by `apps/server/src/lib/env.ts` (Zod schema with defaults).

## Known gotchas

- **tldraw v4**: `createTLStore()` with no args (no `createTLSchema`, no `assets`
  prop on `<Tldraw>`). The custom Yjs binding is in `lib/drawing/yjs-store.ts`.
- **`@fontsource-variable/lato` doesn't exist.** Use `@fontsource/lato` (weights
  400/700) + `@fontsource-variable/geist-mono`.
- **Hocuspocus `onAuthenticated` is `() => void`** — no payload. `readOnly`
  arrives via a `stateless` message in the `connected` hook, not here.
- **`onStateless` signature**: `{ payload: string }` — always JSON.parse it.
- **Protocol types**: every Zod schema needs a matching `export type Foo = z.infer<typeof Foo>`.
  Without it, `import type { Foo }` at call sites throws under `verbatimModuleSyntax`.
- **Hocuspocus `Server` is a singleton** — when running tests that import server
  code, mock `@hocuspocus/extension-database` to prevent the DB extension from
  leaking across test files.
- **`context` in Hocuspocus hooks is typed as `unknown`** — cast with
  `const ctx = context as any` and add a biome-ignore comment.
- **3-tab cap** is enforced server-side with `SELECT FOR UPDATE` inside a
  transaction. The client disables the `+` button at 3 tabs but server is the
  source of truth.
- **First tab seed content**: the server only inserts the DB row for the Welcome
  tab, not the Yjs binary. The client (`markdown-tab.tsx`) detects an empty
  `Y.Text` on a tab named `"Welcome"` with `language="markdown"` and inserts
  the welcome content itself. CRDT semantics make this idempotent.
- **Soft delete only** — `rooms.deleted_at` is set; rows are never hard deleted
  in MVP.
- **Vite chunk size warnings** from Shiki + tldraw are expected and non-blocking.
  tldraw is lazy-loaded.

## Auth flow

1. User hits `/sign-in`, clicks GitHub or Google → `signInWithProvider` triggers Supabase OAuth PKCE.
2. Supabase redirects to `/auth/callback?next=<path>`.
3. `callback.tsx` calls `supabase.auth.exchangeCodeForSession`, then navigates to `next`.
4. `initAuth()` (called once in `main.tsx`) reads the session and populates `useSession`.
5. `onAuthStateChange` keeps `useSession` in sync through the session lifetime.
6. On 401 from `apiFetch`, it tries `supabase.auth.refreshSession()` once, updates
   the token in `useSession`, and retries the request.
7. On token refresh, the `HocuspocusProvider` is destroyed and re-instantiated with
   the new JWT. The in-memory `Y.Doc` survives the reconnect.

## API conventions

- All routes are registered under `/api/rooms` (see `server.ts` — scoped Fastify plugin with `{ prefix: "/api/rooms" }`).
- Auth is `Authorization: Bearer <jwt>` on every route. The `authPlugin` decorator (`app.decorate`) injects `req.user` from the verified JWT — routes use `req.user!.id` and `req.user!.email` (non-null assertion is safe because the auth plugin runs before route handlers).
- Request/response validation uses `fastify-type-provider-zod`: schemas from `@rumi/protocol` are passed directly to route opts (`{ schema: { body: CreateRoomBody } }`).
- Responses wrap domain objects in an envelope key: `{ room: ... }`, `{ rooms: [...] }`, `{ invite: ... }`. DELETE returns 204 with no body.
- Errors use `AppError` / `AuthError` subclasses caught by the global error handler, which returns `{ error: { code, message } }` (see `lib/errors.ts`).
- `app.service` and `app.tabsService` are Drizzle-backed service objects decorated on the Fastify instance. Routes call these, never the DB directly.

## Further reading

- **`docs/SPEC.md`** — authoritative product spec (feature behavior, UX flows, edge cases).
- **`docs/TESTING.md`** — test file conventions, mocking patterns, and how to run/write tests.
- **`docs/LOGGING.md`** — logging conventions, log levels, and structured logging patterns.

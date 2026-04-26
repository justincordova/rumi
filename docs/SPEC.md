# Rumi — System Specification

## Vision

Rumi is a real-time, multi-user collaborative workspace for developers. It enables
multiple participants to work simultaneously inside shared rooms with a unified,
state-synchronized document. The system is state-driven, not request/response —
edits propagate continuously and converge automatically across all clients.

## Goals

- Multiple users edit a shared markdown document in real time with sub-200ms
  perceived remote-edit latency and instant local-edit feel
- Conflict-free, eventually-consistent collaboration with no manual merge UI
- Authenticated, room-scoped access control via OAuth
- Durable persistence with at-most ~10 seconds of data-loss risk per room
- Developer-first aesthetic — plain-text markdown with syntax highlighting,
  not WYSIWYG

## Non-Goals (MVP)

- Drawing canvas (deferred, planned post-MVP)
- Code tabs (deferred, planned post-MVP)
- Cursor awareness in the editor (deferred)
- Full version history / time-travel
- Permissions and roles beyond room membership
- Anonymous / guest access — sign-in is required
- Offline-first / local-first behavior
- Email/password auth, magic links, account recovery flows
- Multi-region / multi-instance scaling (single-instance MVP)

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

- **Web client** (`apps/web`) — React + Vite SPA. CodeMirror 6 markdown editor
  bound to a Yjs document via `y-codemirror.next`. Connects to the server via
  `@hocuspocus/provider` over WebSocket. Auth via `@supabase/supabase-js`.
- **Server** (`apps/server`) — Fastify HTTP for room CRUD and auth-protected
  endpoints; Hocuspocus for WebSocket sync. Validates Supabase JWTs on both
  HTTP and WebSocket connection (`onAuthenticate` hook).
- **Protocol** (`packages/protocol`) — Zod schemas for HTTP request/response
  shapes, presence payload shape, and any custom WS message types beyond
  Hocuspocus's protocol. Imported by both web and server.
- **Postgres (Supabase)** — stores Yjs document binary state (one row per room,
  managed by Hocuspocus's DB extension) and application metadata (rooms,
  memberships) managed via Drizzle.
- **Supabase Auth** — OAuth providers: GitHub, Google. Issues JWTs the server
  validates. No email/password; no magic links.

### Data Flow

**Edit propagation (steady state):**

1. User types in the CodeMirror editor.
2. `y-codemirror.next` applies the edit to the local Yjs document; UI updates
   instantly (~0ms perceived latency).
3. The Yjs update is encoded and sent over WebSocket via `@hocuspocus/provider`.
4. The server's Hocuspocus instance applies the update to its in-memory copy
   of the document and broadcasts it to all other connected clients in the room.
5. Other clients apply the update; their editors reflect the change.
6. Hocuspocus's persistence extension debounces and writes the document state
   to Postgres (every 2s of idle, max 10s).

**Room join:**

1. Client requests `GET /api/rooms/:slug` with Supabase JWT in `Authorization`.
2. Server validates JWT, checks membership, returns room metadata.
3. Client opens WebSocket connection to Hocuspocus with the same JWT.
4. Hocuspocus `onAuthenticate` hook validates the JWT and authorizes the room.
5. Server loads the latest document state from Postgres (or initializes empty)
   and syncs it to the client.
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
| Markdown editor | CodeMirror 6 + `y-codemirror.next` | Plain-text-with-highlighting fits "developer-first simplicity"; smaller than TipTap; muscle memory transfers to future code-tab feature |
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
| Presence shape | `{ user_id, display_name, avatar_url, color }` | Color hashed from `user_id` client-side; cursor position deferred |
| Deployment | Deferred until deploy time | Server requires stateful Node-compatible host; web client is static SPA. Fly.io/Railway/VPS for server, Vercel/Netlify for web |

## Data Model

### Database tables (managed by Drizzle)

**`rooms`**
- `id` — UUID, primary key
- `slug` — text, unique (the shareable room identifier, e.g., `wispy-falcon-42`)
- `name` — text, optional display name
- `owner_id` — UUID, references the Supabase user that created the room
- `created_at` — timestamp
- `updated_at` — timestamp

**`room_members`**
- `room_id` — UUID, references `rooms.id`
- `user_id` — UUID, Supabase user
- `role` — text, MVP-only value `'member'` (placeholder for future roles)
- `joined_at` — timestamp
- Primary key: `(room_id, user_id)`

### Hocuspocus-managed tables

Hocuspocus's database extension creates and manages its own table for Yjs
document binary state. Application code does not read from or write to it
directly.

### Ephemeral state (not persisted)

**Presence** — broadcast over WebSocket via Yjs awareness protocol; never
written to Postgres:
- `user_id`
- `display_name`
- `avatar_url`
- `color` (deterministic hash of `user_id`, computed client-side)

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
  refreshes via `@supabase/supabase-js`. Long-lived WebSocket connections need
  to handle re-auth — TBD in implementation, likely by reconnecting on token
  refresh.
- **Slug collisions.** Word-slug generation must check against existing slugs
  and retry on collision. Deterministic; collision rate is low but nonzero.
- **Yjs document size.** Documents grow over time even after deletes (CRDT
  history is appended). Hocuspocus periodically compacts. Worth monitoring.
- **Room membership semantics.** MVP: any signed-in user with the slug can
  request to join, and is auto-added to `room_members` on first connect.
  Tightening this (invite-only, owner approval) is post-MVP.
- **Performance target.** Local edits feel instant; remote edits propagate
  within 200ms typical (network-bound; Hocuspocus's relay is sub-ms).

## Open Questions

- WebSocket re-authentication strategy on JWT refresh — handle via reconnect or
  via in-band refresh message? Decide during implementation.
- Slug word list source — bundle a curated list, use `friendly-words` package,
  or generate from a custom word file? Cosmetic, defer to plan.
- Migration strategy if/when the room model changes (renaming slug, transferring
  ownership). Out of scope for MVP but worth noting.

## References

- [Yjs](https://github.com/yjs/yjs) — CRDT library
- [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) — Yjs server
- [Fastify](https://fastify.dev) — backend framework
- [Drizzle ORM](https://orm.drizzle.team) — TypeScript ORM
- [Supabase](https://supabase.com) — Postgres + Auth
- [CodeMirror 6](https://codemirror.net) — editor
- [TanStack Router](https://tanstack.com/router)
- [Biome](https://biomejs.dev) — lint + format

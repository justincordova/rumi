# Rumi — System Specification

## Vision

Rumi is a real-time, multi-user collaborative workspace for developers. It enables
multiple participants to work simultaneously inside shared rooms with a unified,
state-synchronized document. The system is state-driven, not request/response —
edits propagate continuously and converge automatically across all clients.

## Goals

- Multiple users edit shared content in real time with sub-200ms perceived
  remote-edit latency and instant local-edit feel
- Per room, configurable tabs (plan-gated cap) of two kinds:
  - **Tab** — a unified text editor that can be set to plain text, any code
    language (syntax highlighted), or markdown (with a toolbar and a 3-way
    view-mode toggle: split, rendered-only, source-only)
  - **Drawing** — a collaborative whiteboard powered by tldraw with sync'd
    grid/background settings
- Conflict-free, eventually-consistent collaboration with no manual merge UI,
  per tab
- Authenticated, room-scoped access control via OAuth
- Per-room visibility control (`open` vs `private`) and a guest access toggle
  (`none | view | edit`)
- Three-tier role model: owner, admin, member — admins can manage tabs and
  members; members can edit content only
- Whitelist/blacklist access model for private rooms: owner/admin adds emails
  to the whitelist; blacklisted users are always denied
- Owner-managed member management: promote/demote roles, kick members, leave
  rooms, transfer ownership
- Guest (unauthenticated) access: read-only or edit access via a persistent
  browser-local UUID identity; controlled per-room by the owner
- In-app notification feed (bell popover) for access-granted and
  invite-accepted events, with email delivery via Resend and RFC 8058 one-click
  unsubscribe
- Subscription billing via Stripe (embedded Checkout, Customer Portal, webhooks)
  with three plans: Free, Pro ($8/mo), Max ($20/mo)
- Plan-aware enforcement: room count, tab count, concurrent user limits
- Landing page with hero, interactive sandbox, pricing, and cookie consent
- User-changeable preferences for theme, UI font, and editor font (client-side
  persistence)
- Durable persistence with at-most ~10 seconds of data-loss risk per tab
- Developer-first aesthetic — plain-text editing surfaces with syntax
  highlighting, plus a markdown preview when the tab is set to markdown

## Non-Goals

- Cursor awareness in the editor (deferred)
- Full version history / time-travel
- Public room directory / discovery — `visibility: "public"` is not a value
- Server-synced user preferences — settings live in the browser only for MVP
- Offline-first / local-first behavior
- Email/password auth, magic links, account recovery flows
- Hard delete of rooms — deletion is soft (`deleted_at`)
- Multi-region / multi-instance scaling (single-instance MVP)
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

## Accessibility scope

The bar is **WCAG 2.1 AA**, verified against the rendered UI rather than the
source:

- **Contrast.** 4.5:1 for body text, 3:1 for large text and for the boundary of
  any control whose fill matches its surround (inputs, outline buttons, the
  off-state switch track). Measured by sampling rendered glyph pixels — computed
  styles miss Tailwind opacity modifiers, which compile to `oklab()` with an
  alpha channel.
- **Keyboard.** Every control reachable, with a visible focus indicator, in a
  logical order. Dialogs trap focus and return it to the control that opened
  them. A control that is invisible until hover must also reveal on
  `focus-visible`.
- **Names and structure.** Every control has an accessible name; each screen has
  one `h1`, no skipped heading levels, and a `<main>` landmark.
- **Targets.** 24×24px minimum, and 44×44px where a mis-tap is destructive or
  changes a privacy choice.
- **States.** Loading, empty, error and disabled states exist wherever the UI can
  enter one. The UI must not assert a value it failed to load — e.g. a failed
  subscription fetch renders an explicit unknown state, never "Free".

Constrained tokens and the reasoning behind each value are recorded inline in
`globals.css`; `AGENTS.md` lists the ones that will regress if lightened.

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
│   ├── TESTING.md
│   ├── LOGGING.md
│   ├── STRIPE_SETUP.md
│   └── designs/      # In-flight feature design docs
├── biome.json
├── bunfig.toml       # Root: preloads test-setup.ts (env vars only)
├── test-setup.ts     # Preloaded by bunfig.toml — sets env vars for all tests
├── package.json      # Bun workspace root
└── tsconfig.base.json
```

### Backend module structure (`apps/server/src/`)

```
auth/
  plugin.ts       — Fastify auth decorator; injects verified user into request
  verify.ts       — JWT verification via jose + JWKS
  jwks.ts         — JWKS URL fetcher / cacher
  supabase-admin.ts — getUserProfile, lookupUserIdByEmail via service role
billing/
  plans.ts        — Stripe price ID mapping
  routes.ts       — POST /checkout/embedded, POST /portal
  service.ts      — createBillingService (checkout, portal, upsert)
  stripe.ts       — Stripe client init + isStripeConfigured guard
  webhook.ts      — POST /billing/webhook (raw body, signature verify)
db/
  schema.ts       — Drizzle table definitions (rooms, room_members, room_whitelist,
                    room_blacklist, tabs, tab_documents, subscriptions,
                    processed_webhook_events, notifications, notification_preferences)
  client.ts       — Drizzle db instance
  documents.ts    — fetchDocument / storeDocument (Yjs binary state)
lib/
  env.ts          — Zod-parsed env (PORT, DATABASE_URL, SUPABASE_*, STRIPE_*, RESEND_*, etc.)
  errors.ts       — AppError, AuthError, envelope() helper
  logger.ts       — Pino instance
notifications/
  service.ts      — recordNotification, listNotifications, markRead, get/updatePreferences
  routes.ts       — GET /, POST /read, GET/POST /preferences, POST /unsubscribe
  email.ts        — Resend email sender (graceful stub when API key missing)
  templates.ts    — HTML email template (accessGranted)
  unsubscribe.ts  — HMAC-SHA256 token sign/verify for one-click unsubscribe
rooms/
  service.ts      — createRoom, listRooms, getRoomBySlug, updateRoom, softDeleteRoom,
                    restoreRoom, whitelist/blacklist CRUD, member management
  routes.ts       — HTTP routes for rooms + whitelist/blacklist + members
  serialize.ts    — serializeRoom, serializeTab, serializeWhitelistEntry, etc.
  tabs.service.ts — listTabs, createTab (plan-gated cap), updateTab, deleteTab, reorderTabs
  tabs.routes.ts  — HTTP routes for tabs
  slug.ts         — Word-slug generator with collision retry
  plan.ts         — PLAN_LIMITS, resolvePlan, getUserPlan
  purge.ts        — Soft-delete purge scheduler
subscriptions/
  routes.ts       — GET /me (returns subscription state)
sync/
  hocuspocus.ts   — Server.configure: onAuthenticate, onAwarenessUpdate, onStoreDocument,
                    connected (sendStateless), onDisconnect
  authorize.ts    — onAuthenticate implementation (JWT + guest + whitelist/blacklist checks)
  persistence.ts  — @hocuspocus/extension-database wired to fetchDocument/storeDocument
  presence.ts     — colorFor(userId), trustedIdentityFor (awareness identity stamping)
  control.ts      — broadcastTabsCreated/Updated/Reordered/Deleted via openDirectConnection
  connection-limits.ts — enforceConnectionLimits per plan
server.ts         — Fastify app wiring; HTTP upgrade → Hocuspocus /ws; route registration
```

### Web module structure (`apps/web/src/`)

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
  guest.ts        — getGuestId() (localStorage UUID), useIsGuest()
  welcome-content.ts — Seed text injected into the first Welcome tab on empty Y.Text
  plans.ts        — Plan definitions (Free/Pro/Max) + comparison rows
  seo.ts          — useSeoMeta helpers
  analytics.ts    — Consent-based analytics loading
  collab/
    awareness.ts  — buildLocalAwareness(user): LocalAwareness (display_name, avatar_url)
  markdown/
    languages.ts  — Language registry; lazy CodeMirror extensions
    render.ts     — unified/remark/rehype pipeline + rehype-sanitize
  drawing/
    yjs-store.ts  — createYjsStore: Y.Doc ↔ TLStore bi-directional binding
    theme.ts      — useTldrawTheme: maps prefs + next-themes to tldraw theme token
    grid.tsx      — DrawingGrid: renders dots/lines overlay synced via Yjs
stores/
  rooms.ts        — Zustand rooms store (dashboard list, optimistic updates, sort/view prefs)
  subscription.ts — Subscription state + polling (fetch, pollUntilPlanChange)
components/
  topbar/         — TopBar, RoomMenu, RoomTitle, ShareButton, PlanBadge, VisibilityBadge, etc.
  editor/
    use-tab-doc.ts         — HocuspocusProvider per tab; onStateless → setReadOnly
    use-room-control-doc.ts — HocuspocusProvider for "room:<id>"; same pattern
    tab-editor.tsx         — Dispatches to MarkdownTab / CodeTab / DrawingTab by tab.type
    tab-cm.tsx             — CodeMirror 6 with Yjs binding + Compartments for hot-swap language
    markdown-tab.tsx       — Split/rendered/source modes; welcome seed on empty Y.Text
    code-tab.tsx           — tab-cm.tsx with language-specific extensions
    drawing-tab.tsx        — tldraw + createYjsStore + grid sync + readOnly via admin check
    markdown-toolbar.tsx   — Toolbar buttons + language picker + view-mode toggle
    markdown-preview.tsx   — Debounced Y.Text observer → Shiki-enhanced HTML
    presence-avatars.tsx   — Awareness states → overlapping avatar stack
    read-only-pill.tsx     — Badge shown when readOnly=true
    connection-status.tsx  — WS status indicator
    editor-skeleton.tsx    — Loading skeleton
    guest-banner.tsx       — Dismissable banner for guest users
    yjs-doc-cache.ts       — Shared Y.Doc / HocuspocusProvider cache keyed by document name
  notifications/
    bell-popover.tsx       — Bell icon + popover with notification feed
    notification-item.tsx  — Per-row rendering (icon + text + time)
    use-notifications.ts   — Hook: polls /api/notifications, exposes unreadCount + markRead
  rooms/
    room-card.tsx, room-row.tsx, empty-state.tsx
    create-room-dialog.tsx, delete-room-dialog.tsx, trash-dialog.tsx
    members-dialog.tsx     — Members list, role management, whitelist/blacklist, kick/leave
  tabs/
    tab-bar.tsx       — Tab strip with drag-to-reorder (dnd-kit) + active highlight
    add-tab-popover.tsx — Popover to pick tab type (text/drawing) then POST
    use-tabs.ts       — Y.Array<TabSummary> observer from the control doc
    tab-icons.ts      — Tab type → icon map
  billing/
    checkout-modal.tsx — Stripe embedded checkout modal
  landing/
    landing-page.tsx, hero.tsx, sandbox/, pricing-section.tsx, cookie-consent.tsx, etc.
  ui/               — shadcn/ui primitives (button, input, dialog, dropdown-menu, etc.)
routes/
  __root.tsx            — ThemeProvider, Toaster, RouterProvider shell
  index.tsx             — Landing page (redirects authed users to /dashboard)
  sign-in.tsx           — OAuth sign-in page (GitHub + Google)
  pricing.tsx           — Standalone pricing page
  auth/callback.tsx     — PKCE callback handler
  _authed.tsx           — beforeLoad auth guard; redirects to /sign-in if anonymous
  _authed/
    dashboard.tsx       — Dashboard (room list, create, delete, trash)
    settings.tsx        — Settings with General (appearance + notifications), Account, Billing tabs
    upgrade.tsx         — Redirects to /pricing
  r.$slug.tsx           — Room page (no auth guard — supports guest access)
```

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
  - **Drawing** — tldraw, bound to a Yjs `Y.Map` per tab via a custom
    bi-directional binding. Grid/background settings (off/lines/dots)
    synced via a shared `Y.Map` and restricted to owner/admin writes.
  - Connects to the server via `@hocuspocus/provider` over WebSocket
    (one provider per room, multiple Yjs sub-documents per tab). Auth
    via `@supabase/supabase-js`.
- **Server** (`apps/server`) — Fastify HTTP for room/tab CRUD, billing,
  notifications, and auth-protected endpoints; Hocuspocus for WebSocket sync.
  Validates Supabase JWTs on both HTTP and WebSocket connection
  (`onAuthenticate` hook). Guest connections (no JWT) are allowed when
  the room's `guestAccess` is not `none`.
- **Protocol** (`packages/protocol`) — Zod schemas for HTTP request/response
  shapes, tab metadata, notification types, billing types, subscription
  state, role enum, whitelist/blacklist types, and any custom WS message
  types beyond Hocuspocus's protocol. Imported by both web and server.
- **Postgres (Supabase)** — stores Yjs document binary state (one row per
  *tab*, via the `@hocuspocus/extension-database` extension wired to our
  Drizzle-managed `tab_documents` table) and application metadata (rooms,
  tabs, memberships, subscriptions, notifications, whitelist, blacklist).
  **Cloud Supabase is the only Postgres in MVP** — there is no local Docker
  Postgres. Each developer uses their own Supabase project (free tier) for
  dev.
- **Supabase Auth** — OAuth providers: GitHub, Google. Issues JWTs the server
  validates. No email/password; no magic links.
- **Stripe** — embedded Checkout for new subscriptions, Customer Portal for
  plan management (cancel, switch, update payment), webhooks for server-side
  subscription state sync. Three plans: Free, Pro ($8/mo or $72/yr), Max
  ($20/mo or $180/yr).
- **Resend** — transactional email for notifications (access granted,
  invite accepted). Graceful stub mode when `RESEND_API_KEY` is not set.

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

**Room join (open room):**

1. Client requests `GET /api/rooms/:slug` with Supabase JWT.
2. Server validates JWT, checks membership. If not a member, auto-joins as
   `member` role.
3. Client opens a WebSocket connection to Hocuspocus with the JWT.
4. `onAuthenticate` validates the JWT, authorizes the room, checks blacklist.
5. For each tab the user opens, the client subscribes to that tab's Yjs
   sub-document; the server loads the latest state from Postgres and syncs.
6. Client begins broadcasting presence; server relays presence to the room.

**Room join (private room via whitelist):**

1. Owner/admin adds email to whitelist. If the email matches a registered
   user, a `room_access_granted` notification is created and an email is sent.
2. The invited user sees the room in their dashboard with `pendingAccess: true`.
3. When they click into the room, `getRoomBySlug` detects the whitelist match
   and auto-joins them as `member`.
4. A `invite_accepted` notification is sent to the room owner.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo layout | Bun workspaces monorepo (`apps/*`, `packages/*`) | Industry default for real-time collab projects; shared types between client and server are first-class |
| Backend organization | Feature-scoped modules, not layered | Matches the shape of the problem (small domain, mostly sync + persistence). Layered/hexagonal is ceremony with no payoff here |
| Runtime | Bun | Fast startup, native TS, native `.env`, zero-config test runner |
| Backend framework | Fastify | Modern Express replacement; first-class TS, schema validation, plugin ecosystem, built-in Pino logging |
| Realtime sync engine | Hocuspocus + Yjs | Production-grade Yjs server. Solves sync, awareness, persistence hooks, auth hooks out of the box |
| Validation | Zod | Industry default for runtime TS schemas; reused for HTTP, WS protocol, env vars |
| Persistence DB | Postgres on Supabase | Production-grade from day one; managed hosting eliminates DB ops; auth in same product |
| ORM | Drizzle + drizzle-kit | TS-native, SQL-shaped, no codegen step, first-class Bun support |
| Auth | Supabase Auth, OAuth-only (GitHub + Google) | Eliminates email infrastructure entirely; matches developer audience; required for all access |
| Guest access | `guestAccess` enum (`none \| view \| edit`) per room | No illegal states; self-documenting; safe default (`none`); orthogonal to visibility type |
| Guest identity | `localStorage` UUID (`rumi_guest_id`); not stored in DB | Stateless; no schema complexity; good enough for ephemeral presence |
| Room visibility | Two types only: `open \| private` | Matches user mental model; eliminates confusing `link`+`link_can_edit` combination |
| Role model | Three roles: `owner \| admin \| member` | Admin manages tabs + members; member edits content only. Owner retains all powers including room deletion and visibility changes. |
| Access model | Whitelist + blacklist for private rooms | Replaces traditional invites. Whitelist = invited emails. Blacklist = denied emails. Blacklist takes priority. Auto-join on match. |
| Member management | Owner manages roles; owner/admin can kick; any non-owner can leave | Owner-only promotion/demotion. Kick auto-adds to blacklist. Owners must transfer before leaving. |
| Billing | Stripe embedded Checkout + Customer Portal + webhooks | Standard SaaS billing; embedded checkout keeps users on-site; webhooks keep server authoritative |
| Plans | Free / Pro ($8/mo) / Max ($20/mo) | Free tier is usable; Pro and Max unlock higher limits. Yearly discounts available. |
| Plan enforcement | `getUserPlan` reads subscriptions table; enforced at WS auth and HTTP endpoints | Server-authoritative. On subscription change, `dropUserConnections` forces WS reconnect for re-evaluation. |
| Notifications | In-app bell popover (30s polling) + email (Resend) | Two channels for the same events. Polling is simple and sufficient for MVP volume. |
| Notification events | `room_access_granted`, `invite_accepted` | High-signal events only. Access granted fires when added to whitelist. Accepted fires when the invitee joins. |
| Email delivery | Resend with graceful stub when API key missing | Clean DX; dev doesn't need a Resend account. RFC 8058 one-click unsubscribe for Gmail compliance. |
| Frontend build | Vite + React + TypeScript | Modern default; fast HMR; good TS story |
| Tab editor | CodeMirror 6 + `y-codemirror.next` | One editor with per-tab language; markdown is just `language=markdown` with toolbar + preview |
| Code-block syntax highlighting | Shiki | VS Code's TextMate grammars; ~150 languages; consistent across surfaces |
| Drawing surface | tldraw + custom Yjs binding | Production-grade collaborative whiteboard; custom Y.Map binding reuses Hocuspocus infrastructure |
| Drawing grid sync | Y.Map shared state, restricted to owner/admin writes | Grid setting (off/lines/dots) synced via CRDTs; only admins can change it |
| Tab reorder | dnd-kit with server-side ordinal re-pack | Server is source of truth; drag is UX only. Last-writer-wins for concurrent reorders. |
| Subscription store | Zustand store with `pollUntilPlanChange` | Replaces duplicated per-component polling. Used by topbar, settings, pricing page. |
| Landing page | Static marketing page with interactive sandbox | Hero + animated word swap + live markdown/drawing preview. Cookie consent tied to analytics. |
| Tabs per room | Plan-gated: Free=3, Pro=10, Max=50 | Cap is the monetization lever. Server-enforced at insert time. |
| Tab type model | Discriminated by `type`: `tab` (text/code/markdown) or `drawing` | Two surfaces, one tab list. Type is immutable after creation. |
| Markdown view modes | Per-tab toggle: split → rendered-only → source-only | Cycles via toolbar button. Per-tab and per-session (not persisted). |
| Markdown rendering | CommonMark + GFM; sanitized via `rehype-sanitize` | Tables and task lists ship by default. Sanitizer removes pasted HTML. |
| Yjs client transport | `@hocuspocus/provider` | Matches the server; handles reconnection and resync automatically |
| Frontend state | Zustand (app-level UI); Yjs (document state) | Right-sized for app-level UI state |
| Routing | TanStack Router | Fully type-safe routes; modern |
| Styling | Tailwind v4 with Catppuccin theme tokens | Native CSS engine; pairs well with shadcn/ui. Catppuccin Latte (light) + Mocha (dark). A few tokens are pinned to the darkest/lightest ramp entry that clears WCAG AA rather than the nominal palette value — see Accessibility scope. |
| Linting/formatting | Biome | Single tool replaces ESLint + Prettier; fast |
| Testing | `bun test` | Built into the runtime; Jest-compatible API; zero config |
| Logging | Pino (built-in to Fastify) + `pino-pretty` for dev | Modern structured logging |
| Security | `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` | Fastify-native |
| Room ID format | Short word-slug (e.g., `wispy-falcon-42`) | Shareable, human-readable, low collision at MVP scale |
| Snapshot cadence | Hocuspocus defaults: 2s debounce, 10s max wait | Bounds data-loss to ~10s while minimizing DB writes |
| Presence shape | `{ user_id, display_name, avatar_url, color }` | `user_id` and `color` stamped server-side; `display_name` and `avatar_url` client-supplied |
| User preferences storage | Client-only (Zustand + `localStorage`) | No DB sync for MVP |
| UI font | Lato via `@fontsource/lato` (default); user-changeable | Warm, humanist sans |
| Editor font | Geist Mono via `geist` package (default); user-changeable | Modern monospace |
| Default theme | Dark mode default; toggle via `next-themes` | User preference; light is first-class |
| Soft delete | `rooms.deleted_at` timestamp; filtered from queries | Preserves CRDT data and audit trail. Trash UI shows rooms with restore option. |
| Invite identifier | Email-only; no username system | Universal; matches OAuth providers' primary identifier. |

## Data Model

### Database tables (managed by Drizzle)

**`rooms`**
- `id` — UUID, primary key
- `slug` — text, unique (the shareable room identifier, e.g., `wispy-falcon-42`)
- `name` — text, optional display name
- `owner_id` — UUID, references the Supabase user that created the room
- `visibility` — text, one of `'open' | 'private'`, default `'open'`
- `guest_access` — text, one of `'none' | 'view' | 'edit'`, default `'none'`
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable. Set on soft delete.

**`room_members`**
- `room_id` — UUID, references `rooms.id`
- `user_id` — UUID, Supabase user
- `role` — text, one of `'owner' | 'admin' | 'member'`. Default `'member'`.
- `joined_at` — timestamp
- Primary key: `(room_id, user_id)`

Owners get implicit admin powers. Admins can create/delete/reorder tabs, manage
members (kick non-admins), manage whitelist/blacklist, and change guest access.
Members can edit tab content only.

**`room_whitelist`**
- `id` — UUID, primary key
- `room_id` — UUID, references `rooms.id` with `ON DELETE CASCADE`
- `email` — text. The invited email. Matched case-insensitively on room join.
- `created_at` — timestamp
- Unique index on `(room_id, email)`

Adding an email to the whitelist auto-removes it from the blacklist. If the
email matches a registered user, a `room_access_granted` notification is created
and an email is sent via Resend.

**`room_blacklist`**
- `id` — UUID, primary key
- `room_id` — UUID, references `rooms.id` with `ON DELETE CASCADE`
- `email` — text. The blocked email.
- `created_at` — timestamp
- Unique index on `(room_id, email)`

Blacklisted users are always denied access, regardless of other factors. Adding
an email to the blacklist auto-removes it from the whitelist and auto-kicks if
the user is a current member. Kick actions auto-add the kicked user's email to
the blacklist.

**`tabs`**
- `id` — UUID, primary key (the stable id used as the Hocuspocus document
  name and as the persistence key for `tab_documents`)
- `room_id` — UUID, references `rooms.id` with `ON DELETE CASCADE`
- `type` — text, one of `'tab' | 'drawing'`
- `language` — text, nullable. Only meaningful when `type='tab'`.
- `name` — text. User-editable display label; max 100 chars.
- `ordinal` — integer. Position in the tab strip; kept contiguous on
  insert/delete/reorder.
- `created_at` — timestamp
- `updated_at` — timestamp
- Index on `(room_id, ordinal)`
- A `CHECK` constraint enforces that `language IS NULL` when `type='drawing'`.

Tab CRUD (create, delete, reorder, rename, language change) is gated to
owner + admin. Members can edit tab content. The tab cap is plan-gated
(Free=3, Pro=10, Max=50) and enforced server-side at insert time.

**`subscriptions`**
- `id` — UUID, primary key
- `user_id` — UUID, Supabase user
- `plan` — text, one of `'free' | 'pro' | 'max'`. Default `'free'`.
- `status` — text, one of `'active' | 'past_due' | 'canceled'`
- `stripe_customer_id` — text, nullable
- `stripe_subscription_id` — text, nullable. Cleared on cancellation.
- `current_period_end` — timestamp, nullable
- `cancel_at_period_end` — boolean, default false
- `created_at` — timestamp
- `updated_at` — timestamp
- Unique index on `stripe_subscription_id`
- Unique index on `user_id` (one subscription per user)

`customer.subscription.deleted` sets `status='canceled'`, clears
`stripeSubscriptionId`, but preserves `plan` and `currentPeriodEnd`.
`resolvePlan` grants paid access until the period ends.

**`processed_webhook_events`**
- `id` — text, primary key (Stripe event ID)
- `created_at` — timestamp
- Used for idempotent webhook processing.

**`notifications`**
- `id` — UUID, primary key
- `user_id` — UUID, the notification recipient
- `type` — text, one of `'room_access_granted' | 'invite_accepted'`
- `payload` — JSONB. Denormalized event data (room info, user info).
- `read_at` — timestamp, nullable
- `created_at` — timestamp
- Index on `(user_id, created_at DESC)` for feed query
- Partial index on `(user_id) WHERE read_at IS NULL` for unread count

**`notification_preferences`**
- `user_id` — UUID, primary key
- `email_enabled` — boolean, default true
- `invite_received_email` — boolean, default true (legacy; kept for compat)
- `invite_accepted_email` — boolean, default true
- `updated_at` — timestamp
- No row = use defaults (all enabled)

### Document persistence

A Drizzle-managed `tab_documents` table stores Yjs binary state, one row
per tab (PK `tab_id`, `state` bytea, `updated_at`). Persistence keys on the
stable `tab_id` UUID, not the room slug. Hocuspocus's `documentName` is the
tab id; the server resolves `tab_id → room_id` once per connection in
`onAuthenticate` so room-level permission checks still apply.

### Ephemeral state (not persisted)

**Presence** — broadcast over WebSocket via Yjs awareness protocol; never
written to Postgres:
- `user_id` — stamped server-side from the verified JWT context
- `color` — deterministic hash of `user_id`, stamped server-side
- `display_name` — client-supplied, cosmetic
- `avatar_url` — client-supplied, cosmetic

### Client-only state

**User preferences** — stored in `localStorage` via a Zustand store:
- `theme` — `'light' | 'dark' | 'system'`, default `'dark'`
- `ui_font` — string identifier from a curated list (default: `'lato'`)
- `editor_font` — string identifier from a curated list (default: `'geist-mono'`)

**Guest identity** — `rumi_guest_id` in `localStorage`. A UUID generated
on first visit; passed as the WebSocket token when no Supabase JWT is present.

## Edge Cases & Constraints

- **Server is stateful.** Active Yjs documents live in Hocuspocus's memory.
  Restarting drops in-memory state but does not lose data — clients reconnect
  and Hocuspocus reloads from Postgres. Data-loss window is ~10s max.
- **Single-instance MVP.** Two server instances cannot share rooms without a
  coordination layer. Out of scope for MVP.
- **Reconnection.** `@hocuspocus/provider` handles automatic reconnection with
  exponential backoff. State resyncs via the Yjs sync protocol on reconnect.
- **Auth token expiry.** Supabase JWTs expire (default 1 hour). The web client
  refreshes via `@supabase/supabase-js`. On `TOKEN_REFRESHED`, the provider
  reconnects with the new JWT; the in-memory Y.Doc survives.
- **Slug collisions.** Word-slug generation checks against existing slugs and
  retries on collision.
- **Access resolution order.** When a user hits a room:
  1. Check blacklist — blacklisted users always denied
  2. Check existing membership — if member, allow with role
  3. For open rooms: auto-join as member (with email dedup)
  4. For private rooms: check whitelist — if whitelisted, auto-join as member; otherwise denied
  5. Guest access checked for unauthenticated users
- **Kick auto-blacklists.** When an owner/admin kicks a member, the user's
  email is automatically added to the blacklist to prevent rejoining.
  Adding to blacklist also auto-removes from whitelist.
- **Whitelist/blacklist mutual exclusion.** Adding to one auto-removes from
  the other. No email can be on both lists simultaneously.
- **Ownership transfer.** Transfers ownership to another member. Old owner
  becomes `admin` (not member). Checks new owner's plan limits. Drops room
  connections so concurrent-user limit re-evaluates.
- **Permission revocation propagation.** Room setting changes and member
  management actions call `dropRoomConnections` or `dropConnectionForUserInRoom`
  after the DB write. Live WS connections drop and reconnect; `onAuthenticate`
  re-evaluates membership and role.
- **Plan-aware tab cap.** Free=3, Pro=10, Max=50. Enforced server-side at
  `POST /api/rooms/:slug/tabs` with plan lookup.
- **Tab reorder.** `POST /api/rooms/:slug/tabs/reorder` with body
  `{ tabIds: string[] }`. Two-phase ordinal update to avoid unique constraint
  violations. Last-writer-wins for concurrent reorders.
- **Drawing grid sync.** Grid setting (off/lines/dots) stored in a `Y.Map`
  on the tab document. Only owners/admins can change it. All clients observe
  and stay in sync via Yjs CRDTs.
- **Billing webhook flow.** `POST /api/billing/webhook` is fully public (Stripe
  signature replaces JWT). Raw body parser scoped via Fastify encapsulation.
  Idempotent via `processed_webhook_events` table.
- **`customer.subscription.deleted` preserves `plan`** — sets `status='canceled'`,
  clears `stripeSubscriptionId`, leaves `plan` and `currentPeriodEnd` intact.
  `resolvePlan` grants paid access until period end.
- **Out-of-order webhook guard** — if row is `status='canceled'` with
  `stripeSubscriptionId=null`, late `updated` with canceled/incomplete_expired
  is ignored. `updated` with `status='active'` for a new subscription passes
  through (re-subscribe case).
- **Notification polling.** Bell popover polls every 30s while page is visible.
  Skips polling when `document.hidden`. Exponential backoff on failures.
- **Email graceful degradation.** When `RESEND_API_KEY` is not set, email sends
  are stubbed to console logs. All other functionality works normally.
- **RFC 8058 one-click unsubscribe.** Emails include `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers. The unsubscribe endpoint accepts both
  browser clicks (returns HTML) and Gmail one-click (accepts form POST).
- **Soft delete.** `rooms.deleted_at` is set; rows are never hard deleted by
  users. A purge scheduler cleans up rooms deleted more than 30 days ago.
  Trash UI shows soft-deleted rooms with restore option.
- **First tab seed content.** Server inserts only the DB row. Client detects
  empty `Y.Text` on a tab named `"Welcome"` and inserts the seed content.
- **Performance target.** Local edits feel instant; remote edits propagate
  within 200ms typical.

## Open Questions

None.

## References

- [Yjs](https://github.com/yjs/yjs) — CRDT library
- [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) — Yjs server
- [Fastify](https://fastify.dev) — backend framework
- [Drizzle ORM](https://orm.drizzle.team) — TypeScript ORM
- [Supabase](https://supabase.com) — Postgres + Auth
- [Stripe](https://stripe.com) — billing
- [Resend](https://resend.com) — transactional email
- [CodeMirror 6](https://codemirror.net) — editor
- [TanStack Router](https://tanstack.com/router)
- [Biome](https://biomejs.dev) — lint + format

# Rumi — Agent Context

Real-time collaborative workspace for developers. Multi-user rooms with tabs
(markdown/code editor) and drawing boards (tldraw). TypeScript monorepo:
Bun + Fastify + Hocuspocus on the server, Vite + React + TanStack Router on
the web, shared Zod protocol package. Billing via Stripe, notifications via
Resend, three-tier role model (owner/admin/member), whitelist/blacklist access
model for private rooms.

## Repo layout

```
rumi/
├── apps/web/          # Vite + React SPA
├── apps/server/       # Bun + Fastify + Hocuspocus
├── packages/protocol/ # Shared Zod schemas
├── docs/              # Spec, roadmap, setup guides, in-flight designs
├── biome.json
├── bunfig.toml        # Preloads test-setup.ts (env vars only)
└── test-setup.ts      # Sets env vars for all tests
```

## Commands

```bash
bun run dev              # Web + server concurrently (prefixed logs)
bun run dev:web          # Vite dev server only
bun run dev:server       # Fastify dev server only
bun run check            # Biome lint + format check
bun run format           # Biome autofix
bun run typecheck        # tsc -b (all workspaces)
bun test apps packages   # All tests
bun --cwd apps/server run db:migrate   # Apply Drizzle migrations
```

The pre-commit gate is: `bun run check` → `bun run typecheck` → `bun test apps
packages` → vite build. All must pass before committing.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Backend | Fastify + `fastify-type-provider-zod` |
| Realtime sync | Hocuspocus + Yjs |
| DB / Auth | Supabase (Postgres + OAuth) |
| ORM | Drizzle |
| Billing | Stripe (embedded Checkout + Customer Portal + webhooks) |
| Email | Resend (transactional; RFC 8058 one-click unsubscribe) |
| Frontend | Vite + React + TanStack Router |
| Styling | Tailwind v4 (Catppuccin Latte/Mocha theme tokens in `globals.css`) |
| State | Zustand (app-level UI); Yjs (document state) |
| Editor | CodeMirror 6 + `y-codemirror.next` |
| Drawing | tldraw v4 + custom Yjs binding |
| Drag-and-drop | dnd-kit (tab reorder) |
| Lint / format | Biome (replaces ESLint + Prettier) |
| Tests | `bun test` (Jest-compatible) |
| Validation | Zod (HTTP, WS protocol, env vars) |

## Key architectural patterns

### WebSocket document naming

Hocuspocus `documentName` is either a tab UUID (per-tab Yjs sub-document) or
`"room:<roomId>"` (room control doc for tab list + presence). `onAuthenticate`
in `apps/server/src/sync/authorize.ts` resolves the name to `roomId` +
optional `tabId`, checks membership and blacklist, and sets `readOnly` on the
context.

### Access resolution (whitelist/blacklist model)

Private rooms use a whitelist + blacklist model instead of traditional invites:
1. Check blacklist — blacklisted users always denied
2. Check existing membership — if member, allow with role
3. For open rooms: auto-join as member
4. For private rooms: check whitelist — if whitelisted, auto-join as member;
   otherwise denied
5. Guest access checked for unauthenticated users

Adding to whitelist auto-removes from blacklist (and vice versa). Kicking a
member auto-adds their email to the blacklist.

### Role model (owner / admin / member)

Three-tier role system on `room_members.role`:
- **Owner**: everything — rename, delete, transfer, change visibility, manage
  roles, manage whitelist/blacklist
- **Admin**: tab CRUD, kick members (not other admins), manage
  whitelist/blacklist, change guest access
- **Member**: edit tab content only. Cannot create/delete/reorder tabs.

Tab CRUD permissions are role-gated in both open and private rooms.

### readOnly propagation

`onAuthenticate` sets `ctx.readOnly`. The `connected` hook fires after auth +
initial sync and sends a stateless message `{ type: "session", readOnly }`.
**Not** `onAuthenticated` (which is `() => void` — no payload).

### Tab list sync (control doc)

Tab metadata lives in a `Y.Array<TabSummary>` inside the room control doc.
The server mutates it directly via `h.openDirectConnection` after any tab CRUD
or reorder (`apps/server/src/sync/control.ts`). Client reads via `useTabs`.

### Plan-aware enforcement

`getUserPlan` in `apps/server/src/rooms/plan.ts` reads `subscriptions` table
and resolves limits (rooms, tabs, concurrent users). Called from
`enforceConnectionLimits` (every WS auth) and `createRoom`/`createTab` (blocks
creation at caps). On subscription change (webhook),
`app.dropUserConnections(userId)` forces WS reconnect so limits re-evaluate.

### Billing webhook flow

`POST /api/billing/webhook` is fully public (Stripe signature replaces JWT).
The route registers its own raw-body content-type parser scoped via Fastify
encapsulation. Signature verification → event routing → `upsertSubscriptionFromEvent`
(idempotent via `processed_webhook_events` table, transactional with the upsert).
Exempted from the global rate limit.

### Notification flow

In-app: bell popover polls `GET /api/notifications` every 30s while page is
visible. Email: Resend sends on access-granted and invite-accepted events.
Graceful stub when `RESEND_API_KEY` is missing (logs to stdout). Unsubscribe
uses HMAC-signed tokens for RFC 8058 one-click compliance.

### Subscription store

Zustand store at `stores/subscription.ts` with `fetch()` and
`pollUntilPlanChange(fromPlan)` (exponential backoff: 0, 750ms, 1.5s, 2.5s, 4s).
Used by topbar PlanBadge, settings BillingTab, and pricing section. Replaces
duplicated per-component polling.

## Known gotchas

- **tldraw v4**: `createTLStore()` with no args (no `createTLSchema`, no `assets`
  prop on `<Tldraw>`). Custom Yjs binding in `lib/drawing/yjs-store.ts`.
- **Drawing uses `YKeyValue<TLRecord>` backed by `Y.Array` named `"tldraw-v2"`**
  (NOT a `Y.Map` named `"tldraw"`).
- **`@fontsource-variable/lato` doesn't exist.** Use `@fontsource/lato` (weights
  400/700) + `@fontsource-variable/geist-mono`.
- **Protocol types**: every Zod schema needs a matching
  `export type Foo = z.infer<typeof Foo>`. Without it, `import type { Foo }`
  throws under `verbatimModuleSyntax`.
- **Hocuspocus `Server` is a singleton** — mock `@hocuspocus/extension-database`
  in tests to prevent DB extension leaking across test files.
- **`context` in Hocuspocus hooks is typed as `unknown`** — cast with
  `const ctx = context as any` and add a biome-ignore comment.
- **First tab seed content**: server inserts only the DB row. Client
  (`markdown-tab.tsx`) detects empty `Y.Text` on a tab named `"Welcome"` and
  inserts the seed content. CRDT semantics make this idempotent.
- **Plan-gated tab cap** enforced server-side. Free=3, Pro=10, Max=50.
  `SELECT FOR UPDATE` in a transaction for concurrent-safe enforcement.
- **Soft delete only** — `rooms.deleted_at` is set; rows are never hard deleted.
  Purge scheduler cleans up after 30 days.
- **Kick auto-blacklists** — kicking a member adds their email to the
  blacklist. Adding to blacklist auto-removes from whitelist.
- **`customer.subscription.deleted` preserves `plan`** — sets `status='canceled'`,
  clears `stripeSubscriptionId`, leaves `plan` and `currentPeriodEnd` intact.
  `resolvePlan` grants paid access until period end. Don't flip `plan` to
  `'free'` on delete.
- **Out-of-order webhook guard** — if row is `status='canceled'` with
  `stripeSubscriptionId=null`, late `updated` with
  `status='canceled'|'incomplete_expired'` is ignored. `updated` with
  `status='active'` for a new subscription passes through (re-subscribe case).
- **Webhook raw body** — `webhook.ts` registers its own `application/json`
  content-type parser that returns raw `Buffer`. Scoped to the webhook plugin
  via Fastify encapsulation; billing routes parse JSON normally.
- **Stripe `apiVersion` is pinned** in `billing/stripe.ts`. Update in lockstep
  with the SDK major version.
- **Email graceful stub** — when `RESEND_API_KEY` is unset, `email.ts` logs the
  payload instead of sending. All other functionality works. Don't gate features
  on email delivery success.
- **Unsubscribe token requires `UNSUBSCRIBE_HMAC_SECRET`** — the unsubscribe
  endpoint returns 400 if the env var is missing. Set it in production.
- **Radix popper z-index** — `[data-radix-popper-content-wrapper]` is forced to
  `z-index: 1000 !important` in `globals.css` to sit above tldraw's UI (~700).
- **Vite chunk size warnings** from Shiki + tldraw are expected and non-blocking.
- **`test-setup.ts` no longer registers happy-dom** — happy-dom setup moved to
  per-file `beforeAll`/`afterAll` in web tests. Root preload only sets env vars.
- **Notification type `room_access_granted`** — this is the active notification
  type (not `invite_received` which is legacy/kept for backward compat).

## API conventions

- Routes under `/api/rooms`, `/api/billing`, `/api/subscriptions`,
  `/api/notifications`.
- Auth: `Authorization: Bearer <jwt>` everywhere except `POST /api/billing/webhook`
  (Stripe signature) and `POST /api/notifications/unsubscribe` (HMAC token).
- Validation: schemas from `@rumi/protocol` via `fastify-type-provider-zod`.
- Responses wrap in envelope: `{ room: ... }`, `{ rooms: [...] }`. DELETE returns 204.
- Errors: `AppError` / `AuthError` subclasses → `{ error: { code, message } }`.
- Services decorated on Fastify instance (`app.service`, `app.tabsService`,
  `app.notifications`). Routes call these, never the DB directly.

## Further reading

- **`docs/SPEC.md`** — authoritative product spec (feature behavior, UX flows, edge cases).
- **`docs/TODO.md`** — product roadmap and what's next.
- **`docs/TESTING.md`** — test file conventions, mocking patterns.
- **`docs/LOGGING.md`** — logging conventions, log levels.
- **`docs/STRIPE_SETUP.md`** — Stripe local dev + going-live checklist.
- **`docs/designs/`** — in-flight feature design docs (win over SPEC.md when they conflict).

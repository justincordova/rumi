# Realtime Tabs (Markdown / Code / Plain Text)

## Context

This is the headline feature of Rumi: a real-time, multi-user collaborative
room with up to 3 tabs of mixed kinds. It sits on top of `auth-and-rooms`
(JWT verification path, room membership rows, the `/r/$slug` route shell)
and consumes the `design-system` tokens for editor typography, the tab bar,
and the markdown toolbar.

A room contains tabs. Each tab is one of two types:

- **Tab** — a unified text editor (CodeMirror 6) backed by a per-tab Yjs
  `Y.Text`. The tab has a `language` property:
  - `null` → plain text, no syntax highlighting
  - `markdown` → markdown grammar; toolbar (H1/H2/bold/italic/list/quote/
    code/link); 3-way view-mode toggle (split | rendered-only | source-only)
    using a CommonMark+GFM renderer with sanitization; Shiki highlights
    fenced code blocks
  - any other registry language (`typescript`, `python`, `go`, etc.) →
    syntax highlighting via Shiki, no toolbar
- **Drawing** — tldraw bound to a per-tab Yjs `Y.Doc`. See
  `drawing.md` for the dedicated design.

The tab system replaces the prior single-document-per-room model. The
prior design's "single-pane, no preview, no toolbar" stance is reversed:
markdown gets a real preview pane and a toolbar because the prototype's
markdown writing UX is a deliberate part of the product.

This doc covers the **Tab** type (text/code/markdown) and the room-level
infrastructure (tab list, sub-document routing, Hocuspocus mount, per-tab
persistence, presence, view-mode toggle). The Drawing tab's library
choice, sync shape, and chrome live in `drawing.md`.

## Goals

- Tab system: per-room tab list with up to 3 tabs (free tier), `+` popover
  to create, double-click to rename, in-tab close button, server-side cap
  enforcement
- Two tab types — `tab` (text/code/markdown) and `drawing` — discriminated
  by `tabs.type`
- One CodeMirror 6 editor for the unified `tab` type, with language as a
  per-tab property (mutable from an in-tab toolbar dropdown)
- Markdown view-mode toggle (split / rendered-only / source-only) with split
  as default, persisted per-tab in local UI state (not synced)
- Markdown toolbar (8 buttons: H1, H2, bold, italic, list, quote, inline
  code, link) plus Cmd/Ctrl+B/I/K shortcuts wired to CodeMirror commands
- CommonMark + GFM rendering with sanitization for the preview pane
- Shiki for code-block syntax highlighting (inside markdown fences and
  for non-markdown `tab` languages)
- Multi-user sync per tab via Yjs CRDTs; sub-200ms remote-edit propagation,
  instant local feel
- Hocuspocus mounted on the same Fastify port via HTTP-upgrade hijack
- Per-tab persistence: one row in `tab_documents` per tab id; binary Yjs
  state
- Lazy doc load on first connect to that tab; eviction after the tab's
  last subscriber disconnects
- Server-side enforcement of `link_can_edit=false` via Hocuspocus
  `readOnly` connection flag (per tab connection)
- Connection-state presence — avatars in the TopBar, no in-editor cursors
- Reconnect-on-`TOKEN_REFRESHED` strategy declared by `auth-and-rooms`,
  consumed here

## Non-Goals

- The Drawing tab's library choice, toolbar, and Yjs shape — see
  `drawing.md`
- Cursor awareness in the editor (deferred per SPEC.md non-goals)
- Drag-to-reorder tabs (deferred; tabs render in `ordinal` order, edited
  only via create/delete)
- Pricing / subscription / paid-tier UI — the 3-tab cap exists but the
  upgrade-affordance copy stays a tooltip until pricing lands
- Markdown live-preview marker hiding inside the source pane (Tier 2 from
  the prior design) — typography only inside the source pane; the
  rendered preview is a separate surface
- Version history, time-travel, document diffs
- Multi-region or multi-instance scaling — single-instance MVP
- Real metrics / Sentry observability — Pino logs only; deploy-time concern
- Sending invitation emails — handled outside this phase
- Editing the dashboard `<TopBar />` beyond extending it with optional
  room-context props (auth-and-rooms owns the dashboard config)

## Design

### File layout

**Backend (`apps/server/src/`):**

```
sync/
  hocuspocus.ts        # Hocuspocus.Server instance, hook wiring
  upgrade.ts           # Fastify HTTP-upgrade hijack handler at /ws
  authorize.ts         # onAuthenticate impl: verifyJwt + tab→room → membership + readOnly
  persistence.ts       # @hocuspocus/extension-database wrapper (per-tab)
  presence.ts          # awareness payload typing
db/
  schema.ts            # ADD: tabs table, tab_documents table
  documents.ts         # fetchDocument(tabId), storeDocument(tabId, state)
rooms/
  tabs.routes.ts       # POST/PATCH/DELETE /api/rooms/:slug/tabs
  tabs.service.ts      # cap enforcement, ordinal management
server.ts              # Updated: register tabs routes + sync after auth plugin
```

**Frontend (`apps/web/src/`):**

```
routes/
  _authed/r.$slug.tsx        # full implementation: tab bar + active tab editor
components/
  topbar.tsx                 # EXTENDED: optional room/provider props (see auth-and-rooms)
  tabs/
    tab-bar.tsx              # tab strip with + popover, double-click rename, close
    add-tab-popover.tsx      # the popover content (Tab / Drawing options)
    tab-icons.ts             # type → lucide icon map (FileText, PenLine)
    use-tabs.ts              # subscribes to tab list via API + WS broadcast
  editor/
    tab-editor.tsx           # entry point: routes by tab.type to MarkdownTab or CodeTab or DrawingTab
    tab-cm.tsx               # CodeMirror mount used by Tab type (text/code/markdown)
    extensions.ts            # markdown(), code language(), yCollab, theme, decorations
    markdown-toolbar.tsx     # 8-button toolbar; visible only when language=markdown
    markdown-preview.tsx     # rendered preview pane (right side of split, or full when rendered-only)
    view-mode-toggle.tsx     # cycles split → rendered-only → source-only
    language-picker.tsx      # dropdown in the tab's toolbar; lists registry
    decorations.ts           # CodeMirror HighlightStyle for source-side typography
    use-tab-doc.ts           # provider+Y.Doc lifecycle hook, keyed on tab id
    presence-avatars.tsx     # consumed by TopBar in room context (room-level, not per-tab)
    connection-status.tsx    # subtle "Reconnecting..." pill (room-level)
lib/
  collab/
    provider.ts              # createTabProvider({ tabId, jwt, onStatus })
    awareness.ts             # awareness payload helpers (color hash, local user)
  shiki.ts                   # singleton Shiki highlighter (lazy-init, languages registered on demand)
  markdown/
    render.ts                # CommonMark+GFM render with rehype-sanitize
    languages.ts             # registry: { id, name, codemirrorLang, shikiLang }
```

`<ConnectionStatus />` renders nothing when `status === "connected"`. On
`"connecting"` after the initial connect (i.e., a reconnect mid-session),
it shows a small pill-shaped indicator in the bottom-right corner with a
spinner and "Reconnecting...". On `"disconnected"` it shows an amber pill
"Disconnected — retrying" and triggers a Sonner toast on the first
transition. The TopBar separately shows an always-on green "Live" pill
when `status === "connected"` (per SPEC and prototype). The two
indicators are complementary: the "Live" pill is the ambient steady-state
signal; the corner pill + toast handle transitions and failure modes.

### Dependencies

- Already present in scaffolding: `@hocuspocus/server`,
  `@hocuspocus/extension-database`, `yjs`, `@hocuspocus/provider`,
  `@codemirror/lang-markdown`, `@codemirror/state`, `@codemirror/view`,
  `codemirror`, `y-codemirror.next`.
- New (server): none beyond scaffolding.
- New (web):
  - `@codemirror/language` (for `HighlightStyle`), `@lezer/highlight`
    (peer of language)
  - `@codemirror/lang-javascript`, `@codemirror/lang-python`,
    `@codemirror/lang-html`, `@codemirror/lang-css`,
    `@codemirror/lang-json`, `@codemirror/lang-rust`, `@codemirror/lang-go`
    (one CodeMirror language pack per language we expose; loaded
    lazily via dynamic `import()` in `lib/markdown/languages.ts`)
  - `shiki` — code-block syntax highlighting; instantiated once via
    `getHighlighter` and reused. Languages and themes are registered on
    demand to keep cold-start cost low.
  - `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`,
    `rehype-sanitize`, `rehype-stringify` — markdown render pipeline
    for the preview pane. Output is HTML strings rendered via
    `dangerouslySetInnerHTML` after sanitization.
- Removed during execute: `@fastify/websocket` (unused; we use HTTP-upgrade
  hijack).

`packages/protocol` adds Zod schemas for the tab CRUD endpoints (see
"Tab CRUD" below) plus a `TabType` / `Language` enum so the client and
server share the registry.

### Env vars

Adds one new env var to `.env.example` (unchanged from prior version):

- `VITE_WS_URL` — e.g. `ws://localhost:3000/ws` for dev,
  `wss://<api-host>/ws` for production. Same host as `VITE_API_URL` since
  the server hijacks Fastify's HTTP upgrade event for WS.

Helmet's `connect-src` directive must include this URL alongside
`VITE_API_URL` and the Supabase URL added in auth-and-rooms.

### Server wiring

`sync/hocuspocus.ts` instantiates a Hocuspocus `Server` with no built-in
HTTP listener. We hand it connections from the Fastify HTTP upgrade event.
Configured extensions: `Database` (custom `fetch`/`store` callbacks). The
`Database` extension uses Hocuspocus's default debounce (2s of idle, 10s
max wait) — no override; this matches SPEC.md's "~10s data-loss boundary"
target. Configured hooks: `onAuthenticate` (from `authorize.ts`), plus
`onConnect`, `onDisconnect`, `onLoadDocument`, `onChange`,
`onStoreDocument` for Pino logging.

`sync/upgrade.ts` registers an HTTP `upgrade` listener on Fastify's
underlying Node server:

```ts
fastify.server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url!, `http://${request.headers.host}`);
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  hocuspocus.handleConnection(socket as any, request, head);
});
```

The `as any` cast bridges Hocuspocus's older WS typings against Node's
strict types. Documented; not a real issue.

`server.ts` registration order:

1. `app.register(authPlugin)` — `onRequest` hook scoped to `/api/*`
2. `app.register(roomsRoutes)` — REST endpoints from auth-and-rooms
3. `app.register(tabsRoutes)` — REST endpoints for tabs (this phase),
   decorated with the Hocuspocus instance via
   `app.decorate("hocuspocus", hocuspocus)` so DELETE handlers can call
   `closeTabConnections(tabId)` on tab deletes; rooms PATCH/DELETE
   from auth-and-rooms call `dropRoomConnections(roomId)` which iterates
   the room's tabs and the control doc, closing each.
4. After `app.ready()`, attach the upgrade listener
5. `app.listen({ port })`

### Cross-phase contract: forced reconnect on room or tab state change

Auth-and-rooms's `PATCH /api/rooms/:slug` and `DELETE /api/rooms/:slug`
handlers call `dropRoomConnections(roomId)` after the DB write commits;
this iterates every tab connection in the room (plus the room's control
doc) and closes each via `hocuspocus.closeConnections(name)`. Tab-level
mutations (PATCH name/language, DELETE tab) call
`closeTabConnections(tabId)` for the single affected tab id.

| Action | Server side | Client side |
|---|---|---|
| PATCH room `linkCanEdit: false` | All tab connections drop for that room | All non-owner clients reconnect → `onAuthenticate` returns `readOnly: true` per tab → editors switch to read-only via the `readOnly` Compartment (no view rebuild). Owner reconnects normally. |
| PATCH room `visibility: link → private` | All tab connections drop | Existing members reconnect normally. Non-members can no longer reach the room. |
| PATCH room `visibility: private → link` | All tab connections drop | Existing members reconnect normally. New visitors auto-join via the HTTP path. |
| PATCH room `name` only | No-op (skip `dropRoomConnections`) | Clients keep their connections; name update propagates via the next `GET /api/rooms` or via dashboard refresh. |
| DELETE room | All tab connections drop | All clients fail `onAuthenticate` with `not_found` → toast + redirect to `/`. |
| POST tab | (no live connection yet for the new tab) | Client receives the new tab via the `tabs.created` server-sent message (see "Tab list sync" below) and adds it to the strip. |
| PATCH tab `name` | No-op on connections | Client receives `tabs.updated` and refreshes the tab label; CodeMirror keeps editing. |
| PATCH tab `language` | No-op on connections (content is unchanged) | Client receives `tabs.updated`, swaps the CodeMirror language extension via a Compartment reconfigure (no view rebuild), and shows/hides the markdown toolbar accordingly. |
| DELETE tab | `closeTabConnections(tabId)` after DB commit | Connected clients drop on that tab; client UI removes the tab from the strip; if it was the active tab, falls back to the previous tab in `ordinal` order. |

The Fastify decorator pattern keeps the dependency one-way: tabs/rooms
routes know about the Hocuspocus instance; the Hocuspocus instance does
not know about the routes.

### Persistence schema

This phase adds a *new migration* on top of the auth-and-rooms migration.
Drizzle-kit generates a sequential migration file that creates the
`tab_documents` table; it does not modify the auth-and-rooms migration
that created `rooms`/`room_members`/`room_invites`/`tabs`.

`db/schema.ts` adds:

```ts
export const tabs = pgTable(
  "tabs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["tab", "drawing"] }).notNull(),
    language: text("language"), // null when type='drawing' or plain-text Tab
    name: text("name").notNull().default("Untitled"),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    roomOrdinalIdx: uniqueIndex("tabs_room_ordinal_unique").on(t.roomId, t.ordinal),
    drawingHasNoLang: check(
      "tabs_drawing_lang_null",
      sql`(${t.type} <> 'drawing' OR ${t.language} IS NULL)`,
    ),
  }),
);

export const tabDocuments = pgTable("tab_documents", {
  tabId: uuid("tab_id")
    .primaryKey()
    .references(() => tabs.id, { onDelete: "cascade" }),
  state: customType<{ data: Uint8Array }>({ dataType: () => "bytea" })("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

**First-tab seed.** When `POST /api/rooms` creates a room (per
auth-and-rooms), the same transaction also inserts a single welcome tab:

```ts
INSERT INTO tabs (room_id, type, language, name, ordinal)
VALUES ($room_id, 'tab', 'markdown', 'Welcome', 0)
```

The first time any client opens that tab, Hocuspocus's `fetchDocument`
returns `null`. To seed welcome content, the client subscribing to a
brand-new tab whose `tab_documents` row is missing detects the empty Y.Doc
state on `onSynced` and applies the welcome content **iff** the tab is
named `"Welcome"`, `language='markdown'`, and the Y.Text is empty. This
keeps the seed logic on the client side (where the welcome markdown
already lives as a constant) and avoids inserting binary Yjs bytes on the
server. Subsequent first-load races are safe: only one of the racing
clients wins via Yjs CRDT semantics; the seed is idempotent (an empty
Y.Text accepts the insert exactly once and additional inserts are no-ops
because the marker text becomes the content). Manual user-created tabs
(any tab not named `"Welcome"` at creation time) start empty and get
CodeMirror's `placeholder()` hint instead.

`db/documents.ts`:

```ts
export async function fetchDocument(tabId: string): Promise<Uint8Array | null> {
  const row = await db
    .select({ state: tabDocuments.state })
    .from(tabDocuments)
    .where(eq(tabDocuments.tabId, tabId))
    .limit(1);
  return row[0]?.state ?? null;
}

export async function storeDocument(tabId: string, state: Uint8Array): Promise<void> {
  await db
    .insert(tabDocuments)
    .values({ tabId, state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tabDocuments.tabId,
      set: { state, updatedAt: new Date() },
    });
}
```

Persistence-key strategy: Hocuspocus calls `fetch(documentName)` with the
tab id the client passed as `name` to the provider. The auth hook resolves
`tab_id → room_id → membership` and stamps `roomId` + `tabId` in the
connection context. The persistence extension reads `tabId` from context.
Storage stays keyed on the stable tab UUID.

### Tab CRUD

All routes require `Authorization: Bearer <jwt>`. The auth plugin
already validates the token and attaches `request.user`. Errors return
the standard envelope from auth-and-rooms.

```
GET /api/rooms/:slug/tabs
  → 200 { tabs: TabSummary[] }   (ordered by ordinal)
  Behavior: requires room membership (or pending-invite resolution
            via the same pattern as GET /api/rooms/:slug).

POST /api/rooms/:slug/tabs
  body: { type: "tab" | "drawing", language?: string | null, name?: string }
  → 201 { tab }
  → 403 if not member or (visibility=link, link_can_edit=false, not owner)
  → 422 { code: "tab_limit_reached" } if room already has 3 tabs
  Behavior:
    1. Verify membership and edit permission (owner OR
       (visibility=link AND link_can_edit=true)).
    2. SELECT count(*) FROM tabs WHERE room_id = $1 FOR UPDATE; reject if ≥ 3.
    3. INSERT with ordinal = (max(ordinal) + 1, default 0); the unique
       index serializes concurrent inserts.
    4. Broadcast `tabs.created` over the room's awareness channel
       (or via a thin "control" Yjs sub-doc per room — see "Tab list sync").

PATCH /api/rooms/:slug/tabs/:tabId
  body: { name?, language? }
  → 200 { tab }
  → 403 if not allowed to edit
  Behavior:
    - name: trim, 1..100 chars, falls back to "Untitled" on empty.
    - language: must be in the registry or null. Only meaningful for
      type='tab'; rejected with 422 for type='drawing'.
    - Side effect: broadcast `tabs.updated`.

DELETE /api/rooms/:slug/tabs/:tabId
  → 204
  Behavior:
    - Reject if the tab is the only remaining tab in the room (a room
      always has ≥ 1 tab; the user can rename or change language but
      never end up with zero). Return 422 { code: "last_tab" }.
    - Cascade deletes the tab_documents row.
    - Re-pack ordinals so they stay 0..n-1 (helper SQL: `UPDATE tabs
      SET ordinal = ordinal - 1 WHERE room_id = $1 AND ordinal > $2`).
    - Side effect: closeTabConnections(tabId);
      broadcast `tabs.deleted`.
```

`TabSummary` shape:

```ts
{
  id: string;
  roomId: string;
  type: "tab" | "drawing";
  language: string | null;
  name: string;
  ordinal: number;
  createdAt: string;
  updatedAt: string;
}
```

Server-side cap enforcement is the source of truth for the 3-tab limit.
The client also disables the `+` button at 3 and shows an upgrade-hint
tooltip; the server rejection is the safety net.

### TabBar visual treatment

The tab strip sits below the TopBar, above the editor surface. Container:
`flex items-end gap-1 px-3 pt-2 border-b border-border bg-background
overflow-x-auto scrollbar-thin`. Horizontal scroll is defensive; at the
3-tab cap it rarely triggers, but a long tab name on a small viewport
can.

Tab dimensions: `h-9`, `min-w-[120px] max-w-[200px]`, `rounded-t-lg`,
`px-3`, `text-[13px]`. Each tab is a button-shaped container with the
type icon (left, 14×14, `text-primary` when active and `text-muted-foreground`
when inactive), the tab name (`truncate font-medium`), and the close
button (right, see below).

Active tab styling: `border border-b-0 border-border bg-surface
text-foreground shadow-xs`. Plus a 1px overlay strip painted over the
strip's bottom border to make the tab visually merge with the editor
surface below — `<span class="absolute -bottom-px left-2 right-2 h-px
bg-surface" />`. This is the signature visual that distinguishes a
tabbed UI from a row of pills.

Inactive tab styling: `border border-transparent bg-transparent
text-muted-foreground hover:bg-muted/60 hover:text-foreground`.

Close button (`X` icon, 16×16): `aria-label="Close tab"`, calls
`e.stopPropagation()` so closing doesn't trigger tab activation. On
inactive tabs it's `opacity-0 group-hover:opacity-100`; on the active
tab it's always visible. Hidden entirely when `tabs.length === 1`
(matches the server's `last_tab` rejection so users never see the
failure path).

Add-tab `+` button (right end of the strip): 32×32 ghost-button. Disabled
(opacity-40, `cursor-not-allowed`) when `tabs.length === 3`, with
`title="Max 3 tabs (upgrade for more)"`. Click opens the add-tab popover
(below).

#### Add-tab popover

Shadcn `Popover`, `align="start"`, content is `w-64 p-1.5`. Opens with
`animate-scale-in` (registered in design-system).

Header row: `text-[11px] uppercase tracking-wide text-muted-foreground
px-2 py-1.5` reading "New tab".

Two option buttons stacked vertically. Each: `flex w-full items-center
gap-3 rounded-md px-2 py-2 text-left hover:bg-muted transition-colors`.

| Slot | Style | Content |
|---|---|---|
| Icon tile (left) | `flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface` with a `h-4 w-4 text-primary` lucide icon | `FileText` for Tab; `PenLine` for Drawing |
| Label (right top) | `text-sm font-medium` | "Tab" / "Drawing" |
| Description (right bottom) | `text-[12px] text-muted-foreground` | "Text, code, or markdown" / "Whiteboard canvas" |

On click, the popover dispatches `addTab(type)`, blurs the trigger, and
programmatically closes (Radix's controlled close). For the "Tab"
option, the new tab is created with `language: null` (plain text) and
`name: "Untitled"`. Auto-numbering of names matches the prototype:
the second `Untitled` tab becomes `Untitled 2`, etc.

#### Rename UX

Double-click a tab to rename. The label swaps to a focused `<input>`
with auto-select-on-edit (`inputRef.current?.select()`). Commit on
blur or Enter; PATCH the tab name. Empty submit falls back to
`"Untitled"`. Escape resets the draft to the current name and exits
edit mode (prevents stale draft on next open). Input chrome:
`border-border bg-surface rounded-md px-2 py-0.5 text-[13px]
font-medium ring-2 ring-ring/30 outline-none`.

### Tab list sync

The tab list itself needs to converge across clients (e.g., one user adds
a tab, another sees it appear). Two approaches considered, picking the
simpler one:

**Approach A — control Y.Doc per room (chosen).** One additional
Hocuspocus document per room, named `room:<roomId>` (vs the per-tab docs
named with the tab id). It contains a single `Y.Array` of tab metadata
rows. Tab CRUD endpoints write to the DB *and* push updates to this
control doc on the server side (Hocuspocus exposes
`hocuspocus.openDirectConnection(documentName)` returning a
`DirectConnection`; mutations must happen inside the connection's
`transact(doc => …)` callback so Hocuspocus broadcasts to subscribers
and triggers persistence). All clients in the room subscribe to this
doc on room enter; they render the tab strip from its `Y.Array`.

**Approach B — server-sent message channel.** Define a custom Hocuspocus
message type for tab list events. More wire surface, more parsing, more
edge cases on reconnect/replay. Rejected.

Approach A reuses the same Yjs+Hocuspocus path as the tab content sync,
keeps everything CRDT, and gets reconnect-replay for free. The control
doc is also persisted to `tab_documents` keyed on a synthetic id
(`tabId = roomId`, `type='control'` row), so a server crash recovers the
tab list along with the content.

To bound the work this phase: the client's source of truth on initial
load is the REST `GET /api/rooms/:slug/tabs` response; the control Y.Doc
is layered on top and provides live updates after that. If the control
doc and the DB ever diverge (e.g., a write succeeded to one and not the
other), `GET /api/rooms/:slug/tabs` is re-fetched on next mount.

### Authorization hook (per-tab)

`sync/authorize.ts`:

```ts
export async function onAuthenticate({ token, documentName, ... }: Payload) {
  // 1. Verify JWT (reuses auth/verify.ts from auth-and-rooms)
  const user = await verifyJwt(token);

  // 2. Resolve documentName → tab → room.
  //    documentName may be a tab id ("uuid") or a control-doc id
  //    ("room:<roomId>"). Both resolve to one room.
  let tab: Tab | null = null;
  let roomId: string;

  if (documentName.startsWith("room:")) {
    roomId = documentName.slice(5);
  } else {
    tab = await db.query.tabs.findFirst({ where: eq(tabs.id, documentName) });
    if (!tab) throw new AuthError("not_found");
    roomId = tab.roomId;
  }

  // 3. Resolve and validate room.
  const room = await db.query.rooms.findFirst({
    where: and(eq(rooms.id, roomId), isNull(rooms.deletedAt)),
  });
  if (!room) throw new AuthError("not_found");

  // 4. Membership check (no auto-join; auto-join is the HTTP path's job).
  const member = await db.query.roomMembers.findFirst({
    where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id)),
  });
  if (!member) throw new AuthError("forbidden");

  // 5. readOnly:
  //    - private rooms: never read-only
  //    - link rooms: read-only for non-owners when link_can_edit=false
  const readOnly =
    room.visibility === "link" &&
    !room.linkCanEdit &&
    member.role !== "owner";

  return { user, roomId, tabId: tab?.id ?? null, readOnly };
}
```

Hocuspocus respects `readOnly` in its protocol layer: update messages from
a read-only connection are dropped server-side. The control doc is also
read-only when `readOnly=true` (so non-owners can see the tab list change
but cannot themselves create/rename tabs through any future client-side
mutation path; CRUD endpoints additionally enforce this server-side).

The contract with `auth-and-rooms`: clients call `GET /api/rooms/:slug`
(which handles `link` auto-join and private invite resolution) *before*
opening any WS connection. The WS hook does not auto-join.

Failure modes inside the hook all produce structured Pino logs at `warn`
level and a clean WS close: `unauthorized` (JWT invalid), `not_found`
(tab/room missing/deleted), `forbidden` (not a member).

### Editor (client) — Tab type

**`use-tab-doc.ts`** — the hook the editor calls per tab. Owns the tab's
Y.Doc and HocuspocusProvider lifecycle. The Y.Doc lives for the tab visit
(keyed on tab id); only the provider is re-instantiated on token refresh.
Destroying the Y.Doc on every token refresh would lose unsaved local edits
that haven't yet been broadcast.

```ts
export function useTabDoc({ tabId }: { tabId: string }) {
  const session = useSession();
  const [status, setStatus] = useState<"connecting"|"connected"|"disconnected">("connecting");
  const [readOnly, setReadOnly] = useState(false);

  // Y.Doc lives for the tab visit, not per-token-refresh.
  const ydoc = useMemo(() => new Y.Doc(), [tabId]);
  useEffect(() => () => ydoc.destroy(), [ydoc]);

  const providerRef = useRef<HocuspocusProvider | null>(null);

  // Provider re-instantiates whenever tabId or token changes.
  useEffect(() => {
    if (!session.token) return;

    const provider = new HocuspocusProvider({
      url: import.meta.env.VITE_WS_URL,
      name: tabId,
      token: session.token,
      document: ydoc,
      onStatus: ({ status }) => setStatus(status),
      onAuthenticated: ({ readOnly }) => setReadOnly(!!readOnly),
    });

    provider.awareness.setLocalState(buildLocalAwareness(session.user));
    providerRef.current = provider;

    return () => {
      provider.destroy();
      providerRef.current = null;
      // Note: do NOT call ydoc.destroy() here.
    };
  }, [tabId, session.token, ydoc]);

  return { ydoc, provider: providerRef.current, status, readOnly };
}
```

A sibling hook, `useRoomControlDoc({ roomId })`, mirrors this for the
control doc (`name: \`room:${roomId}\``). The presence layer hangs off
the *control* provider's awareness so avatars are room-level, not
per-tab.

**`tab-cm.tsx`** — pure CodeMirror mount with the Y binding. Both
`language` and `readOnly` change via CodeMirror `Compartment`s, not by
re-running the mount effect. Rebuilding the `EditorView` on every flip
would reset cursor position, scroll, and undo history.

We do NOT use CodeMirror's `basicSetup` grab-bag (which includes line
numbers, fold gutter, active-line highlight — chrome inappropriate for
a writing surface for plain text and markdown). For the `tab` type we
pick a curated extension list that gives a Bear/Obsidian-style writing
surface for markdown and a clean code-editing surface when a non-markdown
language is set.

```ts
function TabCm({ ydoc, provider, language, readOnly }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());

  // Mount effect — runs once per (ydoc, provider).
  useEffect(() => {
    const ytext = ydoc.getText("content");
    const undoManager = new Y.UndoManager(ytext);

    const view = new EditorView({
      parent: ref.current!,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...markdownShortcutKeymap, // Cmd/Ctrl+B / I / K
          ]),
          EditorView.lineWrapping,
          dropCursor(),
          drawSelection(),
          placeholder("Start writing…"),
          syntaxHighlighting(rumiHighlightStyle),
          rumiEditorTheme,
          langCompartment.current.of(buildLangExtension(language)),
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
          yCollab(ytext, provider.awareness, { undoManager }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ydoc, provider]);   // intentionally NOT language or readOnly

  // Reconfigure-only effect — runs when language changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langCompartment.current.reconfigure(buildLangExtension(language)),
    });
  }, [language]);

  // Reconfigure-only effect — runs when readOnly changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  return <div ref={ref} className="h-full font-mono text-[13.5px]" />;
}

function buildLangExtension(language: string | null): Extension {
  if (!language) return [];                         // plain text
  if (language === "markdown") return markdown();   // CommonMark grammar
  // For other languages, dynamic-import the CodeMirror lang pack from
  // lib/markdown/languages.ts so the bundle stays small.
  return languageRegistry[language]?.cmExtension() ?? [];
}
```

`markdownShortcutKeymap` is a small custom keymap that wraps the current
selection (or inserts placeholder text at the caret) for Cmd/Ctrl+B
(`**…**`), Cmd/Ctrl+I (`*…*`), Cmd/Ctrl+K (`[…](url)`). The same
implementation backs the toolbar buttons so behavior stays identical
between click and shortcut.

**`decorations.ts`** — Tier-1 typography for the source pane. ~60 lines
of CodeMirror config mapping `@codemirror/lang-markdown` highlight tags
to typography (sized headings, monospace inline code, muted markers,
italic emphasis, primary-colored links). When the language is not
markdown, this style mostly no-ops; CodeMirror's default theme handles
basic syntax. For richer multi-language coloring on the source side we
rely on each `@codemirror/lang-*` pack's default highlight tags and the
shared `rumiEditorTheme`.

```ts
export const rumiHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "700", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
  { tag: tags.processingInstruction, color: "var(--color-muted-foreground)" },
  { tag: tags.link, color: "var(--color-primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--color-muted-foreground)" },
  { tag: tags.quote, color: "var(--color-muted-foreground)", fontStyle: "italic" },
]);
```

Colors reference the design system's CSS custom properties — theme switch
flows through automatically.

### Markdown view modes

When `language === "markdown"`, the `<TabEditor>` renders the markdown
toolbar above the editor and wraps the editor in a layout that respects
the per-tab `viewMode` state (`"split" | "rendered" | "source"`).

State: stored in a per-tab Zustand slice, keyed on tab id. Default is
`"split"` on first open. The toggle button cycles split → rendered →
source → split. The state does **not** sync via Yjs awareness and is
**not** persisted to localStorage; closing and re-opening the tab resets
to split. This keeps the toggle as an ephemeral reading-preference and
avoids Yjs awareness pollution.

Layout:

| Mode | Layout |
|---|---|
| `split` (default) | `grid-cols-1 md:grid-cols-2`; source on the left, preview on the right; right border on source pane on `md+`; on phones, stacks vertically with source first. |
| `rendered` | Source pane hidden; preview pane spans full width. The CodeMirror view is *not* unmounted — it stays alive in a hidden container so unsynced local edits aren't lost on toggle. |
| `source` | Preview pane hidden; source spans full width. Toolbar still visible (lets the user wrap selection without seeing the preview). |

`<MarkdownPreview />`:

```tsx
function MarkdownPreview({ ytext }: { ytext: Y.Text }) {
  const [text, setText] = useState(() => ytext.toString());
  useEffect(() => {
    const handler = () => setText(ytext.toString());
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Render via remark-rehype + sanitize on every change.
  // The render is debounced (~50ms) inside renderMarkdown to avoid
  // re-rendering on every keystroke when typing fast.
  const html = useDeferredValue(useMemo(() => renderMarkdown(text), [text]));

  return (
    <div
      className="prose-rumi h-full overflow-auto p-8 text-[14.5px]"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

`renderMarkdown` is the unified pipeline: `remark-parse` →
`remark-gfm` → `remark-rehype` → `rehype-sanitize` → `rehype-stringify`.
Sanitization uses the default GFM allowlist, plus an extension that
allows `class` on `<code>` and `<pre>` (Shiki tokens) and `data-*`
attributes the highlighter writes for theme switching. Fenced code
blocks pass through a Shiki transformer at the rehype stage so the
preview's code blocks render with the same colors as a non-markdown
`tab` editor's source pane.

### Markdown toolbar

Eight buttons (28×28, ghost style, lucide icons, tooltip via `title`),
styled to match the prototype's chrome (`h-10 bg-surface/60 border-b
border-border px-2`). Right side of the toolbar shows the language
picker (a small dropdown listing the language registry, current
selection bolded) and the view-mode toggle button (lucide `Columns2` /
`Eye` / `FileText` depending on current state).

Toolbar buttons all dispatch CodeMirror commands directly against the
view; no synthetic textarea events.

| Button | Command |
|---|---|
| H1 | `prefixLine("# ")` |
| H2 | `prefixLine("## ")` |
| Bold | `wrapSelection("**")` |
| Italic | `wrapSelection("*")` |
| List | `prefixLine("- ")` |
| Quote | `prefixLine("> ")` |
| Inline code | `wrapSelection("\`")` |
| Link | `wrapSelectionAs("[$selection]($url)")` (prompts for URL via a small inline popover; Esc cancels) |

`prefixLine` and `wrapSelection` are pure CodeMirror commands declared in
`extensions.ts`; the same commands back the Cmd/Ctrl+B/I/K shortcuts.

### Language registry

`lib/markdown/languages.ts`:

```ts
export const LANGUAGES = {
  markdown: { name: "Markdown", cmExtension: () => markdown(), shiki: "markdown" },
  typescript: { name: "TypeScript", cmExtension: () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true })), shiki: "typescript" },
  javascript: { name: "JavaScript", cmExtension: () => import("@codemirror/lang-javascript").then(m => m.javascript()), shiki: "javascript" },
  python:     { name: "Python",     cmExtension: () => import("@codemirror/lang-python").then(m => m.python()), shiki: "python" },
  go:         { name: "Go",         cmExtension: () => import("@codemirror/lang-go").then(m => m.go()), shiki: "go" },
  rust:       { name: "Rust",       cmExtension: () => import("@codemirror/lang-rust").then(m => m.rust()), shiki: "rust" },
  json:       { name: "JSON",       cmExtension: () => import("@codemirror/lang-json").then(m => m.json()), shiki: "json" },
  html:       { name: "HTML",       cmExtension: () => import("@codemirror/lang-html").then(m => m.html()), shiki: "html" },
  css:        { name: "CSS",        cmExtension: () => import("@codemirror/lang-css").then(m => m.css()), shiki: "css" },
} as const;
```

The dropdown also has a "Plain text" entry mapped to `language: null`.
Adding a language is a single registry entry plus the matching
`@codemirror/lang-*` package and Shiki language registration.

`buildLangExtension` (in `tab-cm.tsx`) handles the async `cmExtension()`
shape via `Compartment.reconfigure` once the import resolves; while
loading, the editor falls back to plain text. Loading is fast (Vite
chunks each lang pack) and only happens the first time a language is
selected.

### Shiki integration

`lib/shiki.ts` lazily creates one `Highlighter` instance with both the
light and dark theme objects from the design system (or from Shiki's
`github-light` / `github-dark` presets, palette-mapped). Languages are
registered on demand via `highlighter.loadLanguage(name)`.

Three usage sites:

1. Markdown preview — fenced code blocks pass through a `rehype-shiki`
   transformer.
2. Non-markdown `tab` editor source pane — CodeMirror's own
   syntax-tree highlighting drives the source pane (Shiki is not used
   inside CodeMirror because Shiki requires whole-document tokenization
   on each change). For the source pane we rely on each `@codemirror/lang-*`
   pack's default highlight tags + the shared `rumiHighlightStyle`. This
   is a deliberate split: Shiki for static-render preview, CodeMirror's
   own highlighter for live editing.
3. Future: a "view rendered" mode for non-markdown languages could use
   Shiki to render the whole tab as a styled HTML block (out of scope
   for this phase).

### Tab editor entry point

`tab-editor.tsx`:

```tsx
export function TabEditor({ tab }: { tab: TabSummary }) {
  if (tab.type === "drawing") {
    return <DrawingTab tab={tab} />;  // see drawing.md
  }
  // type === "tab"
  const { ydoc, provider, status, readOnly } = useTabDoc({ tabId: tab.id });
  if (!provider) return <EditorSkeleton />;

  if (tab.language === "markdown") {
    return <MarkdownTab ydoc={ydoc} provider={provider} tab={tab} readOnly={readOnly} />;
  }
  return <CodeTab ydoc={ydoc} provider={provider} tab={tab} readOnly={readOnly} />;
}
```

`MarkdownTab` composes `<MarkdownToolbar />`, `<TabCm language="markdown" />`,
and `<MarkdownPreview />` according to the current view mode. The
prototype's passive `"Markdown"` label on the right side of the toolbar
is replaced by the live language picker dropdown — the picker IS the
identifier and lets the user switch the tab to a different language
without opening the settings dropdown.

`CodeTab` composes a thin chrome strip and `<TabCm language={tab.language} />`.
No preview. Chrome strip layout (`h-10 bg-surface/60 border-b border-border
px-3 flex items-center gap-3`):

- Left: filename `tab.name` in `text-[11px] font-medium text-muted-foreground`
- Middle: language picker (same dropdown component used in the markdown
  toolbar)
- Right: `text-[11px] text-muted-foreground` showing
  `{lineCount} lines · {Language.name}` (e.g., `42 lines · TypeScript`)

The prototype's macOS-style traffic-light dots (`bg-destructive/70`,
`bg-warning/80`, `bg-success/70`) are deliberately omitted — they're a
Lovable-era cliché and conflict with the developer-tool aesthetic; the
chrome strip's filename + picker + line count is enough.

### Room route

`apps/web/src/routes/_authed/r.$slug.tsx`:

```tsx
export const Route = createFileRoute("/_authed/r/$slug")({
  loader: async ({ params }) => {
    const room = await fetchRoom(params.slug);
    const tabs = await fetchTabs(params.slug);
    return { room, tabs };
  },
  errorComponent: RoomError,
  component: RoomView,
});

function RoomView() {
  const { slug } = Route.useParams();
  const { room, tabs: initialTabs } = Route.useLoaderData();

  const { tabs, activeTabId, setActiveTabId } = useTabs({
    roomId: room.id,
    initialTabs,
  });

  // Room-level control provider (drives presence + tab list sync).
  const control = useRoomControlDoc({ roomId: room.id });
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div className="flex h-screen flex-col">
      <TopBar room={room} provider={control.provider} status={control.status} />
      <TabBar
        tabs={tabs}
        activeTabId={activeTab?.id}
        onSelect={setActiveTabId}
        onAdd={(type) => createTab(room.slug, { type })}
        onRename={(tabId, name) => patchTab(room.slug, tabId, { name })}
        onClose={(tabId) => deleteTab(room.slug, tabId)}
      />
      <div className="flex-1 min-h-0">
        {activeTab && <TabEditor tab={activeTab} key={activeTab.id} />}
      </div>
      <ConnectionStatus status={control.status} />
    </div>
  );
}
```

The `key={activeTab.id}` on `<TabEditor>` ensures full unmount/remount
when switching tabs, which keeps each tab's editor state isolated and
prevents accidental cross-tab leakage of CodeMirror view state.

`TopBar` is the same component built in `auth-and-rooms`, extended with
optional `room`, `provider`, and `status` props. When `room` is set, it
shows: the brand tile + wordmark, inline editable room title, "Live"
pill driven by `status === "connected"`, presence avatars from
`provider.awareness`, share button (copy link + Sonner toast), and the
settings dropdown (Rename room / Theme / Copy invite link / Sign out).
See `auth-and-rooms.md` for full TopBar spec.

`RoomError` toasts and redirects to `/` on 404 / 403.

### Logging

Every Hocuspocus hook emits a structured Pino log:

| Hook | Level | Fields |
|---|---|---|
| `onAuthenticate` success | `info` | `userId`, `roomId`, `tabId` (or `null` for control), `documentName`, `readOnly` |
| `onAuthenticate` failure | `warn` | `code`, `documentName`, partial `userId` if available |
| `onLoadDocument` | `debug` | `tabId`, `bytesLoaded` |
| `onStoreDocument` | `debug` | `tabId`, `bytesStored` |
| `onStoreDocument` error | `error` | `tabId`, `err` |
| `onConnect` | `debug` | `userId`, `roomId`, `tabId` |
| `onDisconnect` | `debug` | `userId`, `roomId`, `tabId`, `connectionTimeMs` |

Tab CRUD endpoints log at `info` on mutations (create/rename/language/
delete) with `userId`, `roomId`, `tabId`, and the action.

Client logging is minimal: `console.warn` on disconnect, Sonner toast on
the user-visible disconnect/reconnect transitions.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tab system | Per-room tab list, 2 types (`tab` / `drawing`), 3-tab cap (free tier) | Matches the prototype; cap is the natural seam for a future paid tier |
| Tab editor unification | One CodeMirror 6 editor for `tab`-type with language as a per-tab property | Avoids maintaining separate editor stacks for plain text / code / markdown; markdown is just `language=markdown` with a toolbar overlay |
| Code highlighting (preview) | Shiki | Industry-standard TextMate grammars; ~150 languages; same renderer in markdown fences and (future) view-rendered surfaces |
| Code highlighting (source pane) | CodeMirror's per-language packs + a shared `HighlightStyle` | Shiki's whole-document tokenization is too heavy for live editing; CodeMirror's grammars are designed for incremental tokenization |
| Markdown rendering | `unified` + `remark-parse` + `remark-gfm` + `remark-rehype` + `rehype-sanitize` | CommonMark + GFM (tables, task lists, strikethrough); sanitization is non-negotiable since we render HTML |
| Markdown view modes | Split (default) / rendered / source; per-tab session state, not synced, not persisted | Reading-preference is per-user and ephemeral; sync would force everyone to share one view |
| Markdown shortcuts | Cmd/Ctrl+B / I / K via custom CodeMirror commands; same commands back the toolbar | One implementation; behavior identical between click and keyboard |
| Drawing tab | tldraw + Yjs adapter (default chrome) | See `drawing.md` |
| Tab list sync | Per-room control Y.Doc, server-pushed via `Server.openDirect` on CRUD writes | Reuses Yjs/Hocuspocus path; reconnect-replay free; simpler than a custom message channel |
| Persistence keying | `tabs.id` UUID per tab; `room:<roomId>` for the control doc | Stable across renames; tab deletion cascades to `tab_documents` |
| First-tab seed | Server inserts a "Welcome" tab on room creation; client seeds welcome content into the empty Y.Text on first connect | Server stays out of binary Yjs encoding; idempotent because Y.Text seeding is no-op once non-empty |
| Tab cap enforcement | Server-side via `SELECT count FOR UPDATE` + unique `(room_id, ordinal)` index | DB serializes; client UI also disables `+` at 3 |
| Tab order | `ordinal` integer, contiguous; no drag-to-reorder in MVP | Reorder is post-MVP; ordering by creation order matches the prototype |
| Hocuspocus mount | HTTP-upgrade hijack on Fastify's Node server | One port, one process; load balancer needs one upstream |
| WS auth handshake | JWT in Hocuspocus `token` connection param; verified in `onAuthenticate` per connection | Reuses `verifyJwt` from auth-and-rooms; token stays inside the protocol message |
| Membership check | Strict in `onAuthenticate` (no auto-join) | Auto-join is the HTTP path's job |
| Read-only enforcement | `onAuthenticate` returns `readOnly: true` per connection; Hocuspocus drops update messages | Single decision point; protocol-layer enforcement |
| Doc lifecycle | Lazy load on first connect to a tab; evict after that tab's last subscriber disconnects | Memory scales with active *tabs*, not total |
| Compaction | Hocuspocus defaults via `Y.encodeStateAsUpdate` | Compacted format; SPEC.md "growth" warning applies to event-log persistence we're not using |
| Presence | Yjs awareness on the room control doc; avatars in TopBar; no in-editor cursors | Matches SPEC.md non-goal; one source of truth for who's in the room regardless of which tab they're viewing |
| TopBar relationship | Single `<TopBar />` with optional `room`/`provider`/`status` props | One component, two configurations; auth-and-rooms ships dashboard config; this phase extends |
| Failure handling | Structured Pino logs + client Sonner toasts on disconnect | Provider's auto-backoff handles retry; persistence errors don't crash the doc |
| Logging stack | Pino only; no Sentry / Prometheus in this phase | Real observability is a deploy-time concern |

## Rejected Alternatives

- **Single-pane markdown with no preview, no toolbar** (the prior design
  doc's stance) — reverses the prototype's deliberate writing UX. The
  prototype's split + toolbar is what users will compare us against;
  matching it is part of the product.
- **Hand-rolled markdown renderer like the prototype's `lib/markdown.ts`** —
  no tables, no task lists, no ordered lists; inevitable XSS surface as
  features grow. The unified/remark stack costs ~50KB gzipped and ships
  full CommonMark + GFM + sanitization.
- **`marked` instead of `unified`** — smaller, but `unified` composes
  naturally with `rehype-sanitize` and Shiki transformers; a less
  ad-hoc pipeline.
- **Two separate editor components for code-tab vs markdown-tab** —
  duplicates the CodeMirror lifecycle code; makes language switching
  mid-tab impossible. Unifying on one component with language as a prop
  is cleaner.
- **Per-language `monaco` editor instead of CodeMirror** — Monaco is
  ~3MB gzipped, designed for VS Code, overkill for the writing-surface
  use case. CodeMirror 6 is the modern choice for collab + lightweight.
- **Shiki inside CodeMirror via `@shikijs/codemirror`** — exists but is
  experimental; whole-document re-tokenization on every keystroke is
  the wrong shape. Use Shiki for static rendering; use CodeMirror's
  language packs for live editing.
- **Server-stored `view_mode` per user per tab** — adds DB schema for a
  preference no one will miss when it doesn't sync. Local-only is
  cheaper and matches expectations.
- **Tab list as a custom WS message channel** — doubles wire surface,
  adds parsing/replay edge cases. Yjs sub-doc is the same primitive
  everywhere else.
- **Drag-to-reorder tabs** — useful but post-MVP; needs `@dnd-kit`,
  collision logic with the unique `(room_id, ordinal)` index, and
  reconciliation across the control doc. Skip.
- **Bundling all `@codemirror/lang-*` packs upfront** — adds ~200KB
  gzipped for languages most users won't pick. Lazy-load via dynamic
  `import()` on language selection.
- **Hocuspocus on a separate port** — two upstreams, two CORS configs,
  doubled deployment complexity for no MVP gain.
- **`@fastify/websocket` plugin wrapping Hocuspocus** — translation
  layer between two WS abstractions for negative gain.
- **Reject edits in `beforeHandleMessage` instead of `readOnly`** — more
  code, more bug surface; Hocuspocus's `readOnly` flag exists for this.
- **Trust the client for `link_can_edit=false`** — bypassable in devtools.
- **In-editor cursor awareness** — SPEC.md non-goal; would need
  `y-codemirror.next` cursor support, presence-color CSS, cursor-name
  labels, and bounds-checking edge cases.
- **Skip presence entirely in this phase** — room feels dead.
- **Periodic re-compaction job** — premature; we don't yet know if any
  pathology exists at our scale.
- **Sentry / Prometheus from day one** — deploy-time concern.

## Edge Cases & Constraints

- **Concurrent first-connect to a new tab.** Two clients open the same
  newly-created tab simultaneously. Hocuspocus serializes
  `onLoadDocument` per `documentName`; only one Postgres fetch; both
  clients share the hydrated doc.
- **Concurrent welcome-content seed.** Two clients open the welcome tab
  before any content has been seeded. Each detects `ytext.length === 0`
  and tries to seed. Yjs CRDT semantics make the first insert win;
  the second insert sees a non-empty Y.Text and aborts. Worst case:
  duplicate insert produces concatenated welcome content; mitigation is
  to insert via `ytext.applyDelta` only when `ytext.length === 0`
  guarded by an `if` (not perfectly atomic but the race window is sub-ms
  and the result is recoverable by editing).
- **Soft-deleted room mid-session.** Active connections survive until
  next reconnect (token refresh, network blip). On reconnect,
  `onAuthenticate` returns `not_found`, connection closes, client toasts
  and redirects to `/`. We don't proactively evict.
- **`visibility` flipped from `link` to `private` mid-session.** Existing
  members survive (still in `room_members`); new non-member visitors get
  403.
- **`link_can_edit` flipped while editing.** The `readOnly` decision is
  fixed at `onAuthenticate` time per connection. After PATCH's
  `dropRoomConnections`, all tab connections in the room drop and
  reconnect with the new value.
- **Tab deleted mid-edit.** DELETE path's `closeTabConnections(tabId)` drops
  the connection on that tab. The client's `useTabDoc` returns
  `disconnected`; the active-tab fallback selects the previous tab.
- **Tab language changed mid-edit by another client.** The control doc
  broadcasts `tabs.updated`; the client's `useTabs` updates the tab
  metadata; `<TabCm>`'s language Compartment reconfigures. Editor
  state, scroll, and undo history are preserved.
- **Tab created on another client.** The control doc broadcasts
  `tabs.created`; `useTabs` appends; `<TabBar>` renders the new tab.
  Active selection does not change.
- **Persistence write failure.** `@hocuspocus/extension-database` catches
  the throw, logs at `error`, and the next debounce retries. In-memory
  tab doc continues serving. Worst case: server crash + DB still down =
  data loss bounded to last successful save.
- **Fetch failure on first load.** Hocuspocus surfaces the error; client
  toasts "Couldn't load tab. Retrying..."; auto-reconnect retries.
- **Server crash.** All in-memory tab docs lost. Clients reconnect via
  exponential backoff. `onLoadDocument` re-hydrates per tab from
  Postgres. Yjs reconciles client edits made during the outage.
- **Network partition / tab backgrounded.** Browser may suspend; WS
  closes. `@hocuspocus/provider` reconnects with backoff. Local edits
  made offline are stored in client Y.Doc and broadcast on reconnect.
- **Memory pressure with many idle tabs.** Each tab is a separate
  Hocuspocus document. Lazy load + grace evict per tab means dormant
  tabs don't sit in memory. Single-instance MVP doesn't scale to
  thousands of simultaneously-active tabs; documented as a known
  boundary.
- **`@fastify/websocket` in scaffolding deps.** Unused after this phase
  ships; remove from `apps/server/package.json` during execute.
- **Email change vs membership.** Membership keys on `user_id`, not
  email. (Re-noted from auth-and-rooms.)
- **`onAuthenticate` Postgres latency.** Each new tab connection does
  3 queries (tab lookup, room lookup, member lookup). At MVP scale
  this is fine; index-only lookups + a small in-process cache keyed
  on `(userId, roomId)` are the optimization seam if it bites.
- **Awareness payload trust.** `user_id` and `color` are stamped
  server-side from the verified connection context via
  `onAwarenessUpdate` — clients cannot spoof identity. `display_name`
  and `avatar_url` are still client-provided and cosmetic.
- **Markdown preview render cost.** Re-rendering on every keystroke is
  visibly slow on long documents. We use `useDeferredValue` + a 50ms
  debounce inside `renderMarkdown`. Long-document optimization
  (incremental rendering, viewport-bounded rendering) is post-MVP.
- **Sanitization breaking innocent HTML.** If a user pastes HTML they
  expect to render, it gets stripped. This is the trade-off for
  XSS-safety. Documented in the markdown toolbar's tooltip text on
  `?` if we add one.
- **Tab cap race.** Two clients simultaneously POST the 3rd tab. The
  unique `(room_id, ordinal)` index plus the in-transaction count
  serializes; one wins, the other gets `tab_limit_reached`. Acceptable.

## Server-side awareness sanitization

Hocuspocus's `onAwarenessUpdate` hook fires for every awareness change.
The hook overwrites the `user_id` and `color` fields in the local
awareness state from the connection context (`context.user.id`) and a
deterministic hash of that ID. Clients can spoof `display_name` and
`avatar_url` (cosmetic, low-stakes), but identity-bearing fields come
from the verified JWT.

```ts
hocuspocus.configure({
  async onAwarenessUpdate({ context, awareness, states }) {
    const localState = awareness.getLocalState();
    if (localState && localState.user_id !== context.user.id) {
      awareness.setLocalState({
        ...localState,
        user_id: context.user.id,
        color: colorFor(context.user.id),
      });
    }
  },
});
```

Server logs at `warn` if a client attempts to set a `user_id` that
doesn't match its auth context.

## Testing

All server tests use mocked Drizzle — no real DB connection during
`bun test`, consistent with the project-wide approach in
`auth-and-rooms`.

- `sync/authorize.test.ts` — `verifyJwt` mocked; repo mocked. Cases:
  control doc (`room:<id>`) → resolves; valid owner → `readOnly: false`;
  valid non-owner on `link_can_edit=false` → `readOnly: true`; valid
  non-owner on private room → connects; non-member → `forbidden`;
  soft-deleted room → `not_found`; missing tab → `not_found`; JWT
  invalid → `unauthorized`.
- `sync/persistence.test.ts` — `db.query.*` mocked. Fetch returns
  `null` for missing row; store inserts then upserts.
- `db/documents-roundtrip.test.ts` — pure Yjs encode/decode round-trip.
- `rooms/tabs.routes.test.ts` — Fastify `app.inject()` with mocked repo
  and mocked Hocuspocus. Cases:
  - POST hits `tab_limit_reached` at the 3rd tab.
  - POST `type='drawing'` rejects non-null `language`.
  - PATCH `language` rejected for `type='drawing'`.
  - DELETE rejected when only one tab remains (`last_tab`).
    - DELETE calls `closeTabConnections(tabId)` exactly once after commit.
    - PATCH `name`-only does NOT call `closeTabConnections`.
- `rooms/tabs.service.test.ts` — ordinal management on insert/delete;
  unique-violation retry; first-tab seed.
- Client tests (`apps/web/src/components/editor/`):
  - `tab-cm.test.ts` — language Compartment reconfigure: switch from
    plain → markdown swaps the extension without rebuilding the view.
  - `tab-cm.test.ts` — readOnly Compartment reconfigure.
  - `view-mode.test.ts` — split → rendered → source cycle; default split.
  - `markdown-toolbar.test.ts` — bold wrap; H1 prefix-line; link prompt
    flow.
  - `markdown-preview.test.ts` — render of headings, lists, tables, task
    lists; sanitization strips `<script>` tags.
  - `use-tab-doc.test.ts` — mock `HocuspocusProvider`; status
    transitions; provider re-instantiation when token changes; Y.Doc
    survives token refresh.
  - `use-tabs.test.ts` — control doc updates merged with REST initial
    load; concurrent create races converge.
  - `tab-bar.test.tsx` — `+` button disabled at 3 tabs; double-click
    rename commit/cancel; close button visibility rules; `+` popover
    shows Tab and Drawing options.

Manual verification flow (run after execute completes):

1. Sign in, create a room. Welcome tab appears with seeded content;
   markdown preview renders with headings, list, blockquote, fenced TS
   code block (Shiki-highlighted in the preview).
2. Cycle the view-mode toggle: split → rendered-only → source-only →
   split. Verify CodeMirror state survives all transitions.
3. Click `+`, choose "Tab". A new "Untitled" tab appears with no
   language. Type plain text; no highlighting.
4. Open the language picker, choose "TypeScript". Source pane gets
   syntax colors. Switch to "Markdown" — toolbar appears, view-mode
   toggle appears, preview renders.
5. Click `+`, choose "Drawing". A new drawing tab appears with tldraw
   chrome (see `drawing.md`).
6. Click `+` again. The button is disabled with tooltip "Max 3 tabs".
7. Open the same URL in a second browser signed in as a second user
   (auto-joins as `link` default). Both windows show two avatars in
   the TopBar's "Live" state.
8. User A types in tab 1; user B sees it in tab 1 within ~50ms.
9. User A creates a 3rd tab. User B sees it appear instantly in the
   tab strip (control doc sync).
10. User A switches the markdown tab's language to "Plain text". User
    B's editor toolbar disappears; preview disappears; CodeMirror state
    preserved.
11. User A renames a tab (double-click). User B sees the new label.
12. User A deletes a tab. User B sees it disappear; if it was their
    active tab, falls back to the previous one.
13. Stop the dev server. Both clients show "Reconnecting..." pill;
    "Live" pill goes muted. Restart server. Pills clear; tabs and
    content intact.
14. Owner PATCHes `link_can_edit=false`. User B's tab connections drop
    and reconnect; all editors flip to read-only without manual
    refresh; tab CRUD endpoints reject from B.
15. Owner PATCHes `visibility=private`. Sign out user B, sign in as
    user C, paste URL → 403 redirect. Owner invites C → C's dashboard
    shows the room → joins → tabs work.
16. Owner soft-deletes the room. Both connected users get bounced to
    `/` on the next reconnect with a "Room deleted" toast.
17. Leave a tab open with Supabase JWT TTL shortened to 2 minutes.
    Verify token refresh fires, providers reconnect, no visible state
    loss in any tab.
18. Paste `<script>alert(1)</script>` into the markdown source pane.
    Verify the preview pane renders escaped text (no script execution,
    no DOM injection).

Performance check:
- Local edit → remote render time across two windows: target <200ms.
- Markdown preview re-render under sustained typing: no input lag at
  ~80wpm on a 1000-line doc.
- Server memory: open 3 rooms × 3 tabs each, with 1 client each; close
  all; verify after ~60s the docs are evicted (Pino logs
  `onDocumentDestroy`).

## Open Questions

None. SPEC.md's relevant open questions
(WS re-auth on JWT refresh, slug source, cascading invite cleanup on
soft delete) were resolved by `auth-and-rooms`. The remaining SPEC.md
items (settings UI surface, room model migrations) are out of scope for
this phase.

## Notes for sync-docs

The following items are now reflected in this design and need to be
merged into SPEC.md when sync-docs runs:

- Rename `room_documents` → `tab_documents` (per-tab persistence) — done
  in this pass.
- Add the `tabs` table to the data model — done in this pass.
- Update non-goals to remove "drawing canvas deferred" / "code tabs
  deferred" — done in this pass.
- Add the 3-tab cap and pricing-deferred note — done in this pass.
- Add Shiki + tldraw + Markdown rendering to the Key Decisions table —
  done in this pass.

The Drawing tab is documented separately in `drawing.md`.

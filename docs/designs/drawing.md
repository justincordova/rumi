# Drawing Tab

## Context

This design covers the `drawing` tab type in Rumi. Tabs of `type='drawing'`
render a real-time collaborative whiteboard using **tldraw** as the canvas
engine, bound to a per-tab Yjs document so the same Hocuspocus + persistence
infrastructure that powers the Tab editor (text/code/markdown — see
`realtime-markdown.md`) also powers drawings.

This is a separate doc because the library, sync shape, chrome, and
persistence concerns are distinct from the unified text/code/markdown
editor — even though both surfaces reuse the same auth, room membership,
tab list, presence layer, and `tab_documents` storage.

## Goals

- A new drawing surface per `tabs` row of `type='drawing'`, isolated from
  other tabs in the same room
- Real-time multi-user drawing convergence using the same Hocuspocus
  infrastructure as Tab content (Yjs CRDTs over WS)
- Default tldraw chrome and toolset (select / draw / arrow / shapes / text
  / sticky / eraser / etc.) — no custom toolbar in MVP
- Persistence as binary Yjs state in `tab_documents`, keyed on tab id —
  same column, same code path, no schema fork
- Read-only enforcement when `link_can_edit=false` (server-stamped via
  `onAuthenticate`'s `readOnly` flag)
- Theme parity: tldraw renders in light or dark to match the user's
  current theme
- Touch / stylus support out of the box (tldraw's native handling)

## Non-Goals

- Custom drawing toolbar, custom shape library, custom asset pipeline —
  use tldraw's defaults
- Image / file uploads to tldraw shapes — the prototype doesn't have it,
  and tldraw's asset upload requires a storage backend (S3 / Supabase
  Storage) that's out of scope for MVP
- Export to PNG / SVG / PDF — tldraw supports it but the UX surface is
  post-MVP
- Embedding tldraw shapes inside markdown tabs — the two surfaces are
  isolated by design
- Live cursor positions across users (tldraw's awareness can render
  cursors but it's deferred along with the editor cursor non-goal in
  SPEC.md; presence stays at the TopBar avatar level)
- Per-room drawing presets / templates / starter content — drawings
  start blank
- Undo/redo synchronization across users beyond what Yjs naturally
  provides (each user's local undo stack is independent)

## Design

### Library choice

`@tldraw/tldraw` (the React component) plus `@tldraw/sync` *(not used)*.

We're **not** using `@tldraw/sync`'s built-in WebSocket server — that
would mean running a second sync infrastructure separate from
Hocuspocus. Instead we use tldraw's lower-level Yjs binding (the
official `tldraw + yjs` integration pattern, documented in tldraw's
multiplayer docs) so a tldraw `Editor` instance reads and writes its
state to a Y.Doc that we own, and Hocuspocus syncs that Y.Doc the same
way it syncs Tab Y.Docs.

Versions: pin tldraw to a specific minor at execute time to control
upgrade cadence; tldraw is on a fast release cycle.

### File layout (additions to `apps/web/src/`)

```
components/
  editor/
    drawing-tab.tsx          # tldraw <Tldraw> wrapper, mounted per drawing tab
    use-drawing-doc.ts       # thin alias of use-tab-doc.ts; same Y.Doc / provider lifecycle, returns the same shape
lib/
  drawing/
    yjs-store.ts             # tldraw <-> Y.Doc binding (TLStore wired to a Y.Map)
    theme.ts                 # maps usePrefs().theme to tldraw's "light" | "dark"
```

The drawing tab reuses `use-tab-doc.ts` from the realtime-markdown phase
exactly — the hook is type-agnostic and just owns a Y.Doc + provider
keyed on tab id. The only drawing-specific code is the tldraw ↔ Y.Doc
bridge in `lib/drawing/yjs-store.ts` and the React mount in
`drawing-tab.tsx`.

### Dependencies

- `tldraw` (the editor + UI bundle; ~500KB gzipped, lazy-loaded)
- `@tldraw/sync-core` (the store types; small)
- No additional Yjs dependencies — `yjs` is already in scope.

The drawing tab is loaded via `React.lazy(() => import("./drawing-tab"))`
so users who never open a drawing tab don't pay the bundle cost.

### Yjs ↔ tldraw binding

tldraw exposes a `TLStore` interface (its internal reactive store). The
binding writes the store's records into a `Y.Map<TLRecord>` and listens
for remote `Y.Map` changes to apply back into the store.

`lib/drawing/yjs-store.ts`:

```ts
export function createYjsStore({ doc, schema }: { doc: Y.Doc; schema: TLSchema }) {
  const yShapes = doc.getMap<TLRecord>("tldraw");
  const store = createTLStore({ schema });

  // 1. Initial hydrate: pull any existing records from yShapes into store.
  store.mergeRemoteChanges(() => {
    for (const record of yShapes.values()) {
      store.put([record]);
    }
  });

  // 2. Local store changes → write into Y.Map.
  store.listen(
    ({ changes }) => {
      doc.transact(() => {
        for (const r of Object.values(changes.added)) yShapes.set(r.id, r);
        for (const [, r] of Object.values(changes.updated)) yShapes.set(r.id, r);
        for (const r of Object.values(changes.removed)) yShapes.delete(r.id);
      }, "local");
    },
    { source: "user", scope: "document" },
  );

  // 3. Remote Y.Map changes → apply into store.
  yShapes.observe((event, txn) => {
    if (txn.origin === "local") return;
    store.mergeRemoteChanges(() => {
      for (const [key, change] of event.changes.keys) {
        if (change.action === "delete") {
          store.remove([key as TLRecord["id"]]);
        } else {
          const record = yShapes.get(key);
          if (record) store.put([record]);
        }
      }
    });
  });

  return store;
}
```

Notes on the binding:

- Each `TLRecord` is stored as a single value in the Y.Map. tldraw
  records are JSON-serializable plain objects, which Yjs handles
  natively as Y types or primitives.
- Origin tagging (`"local"`) lets the remote-observe path skip its own
  local transactions, preventing feedback loops.
- `mergeRemoteChanges` is tldraw's hook for "apply these changes
  without firing local-change listeners," which keeps the round-trip
  clean.
- Convergence properties: tldraw's CRDT-friendliness is "good enough"
  but not perfect — concurrent edits to the *same shape's same field*
  resolve to last-write-wins (Y.Map's default), which is acceptable
  for a whiteboard because the human users see each other's cursors
  approximately and don't simultaneously edit the same shape's
  position. tldraw does not currently ship a per-field CRDT shape
  type and we won't build one.

### Editor mount

`drawing-tab.tsx`:

```tsx
import { Tldraw, createTLStore, defaultShapeUtils } from "tldraw";
import "tldraw/tldraw.css";

export function DrawingTab({ tab }: { tab: TabSummary }) {
  const { ydoc, provider, status, readOnly } = useTabDoc({ tabId: tab.id });
  const { theme } = useTldrawTheme(); // maps prefs theme → "light" | "dark"

  const store = useMemo(() => {
    if (!ydoc) return null;
    return createYjsStore({
      doc: ydoc,
      schema: createTLSchema({ shapeUtils: defaultShapeUtils }),
    });
  }, [ydoc]);

  if (!provider || !store) return <EditorSkeleton />;

  return (
    <div className="relative h-full">
      <Tldraw
        store={store}
        autoFocus
        inferDarkMode={false}
        // tldraw's own theme prop drives both UI chrome and shape colors
        // through tldraw's user preferences API; we set it imperatively below.
        onMount={(editor) => {
          editor.user.updateUserPreferences({ colorScheme: theme });
          editor.updateInstanceState({ isReadonly: readOnly });
        }}
      />
      {/* tldraw's read-only mode hides editing chrome on its own; we
          additionally render a top-right pill when readOnly so the user
          knows why nothing happens when they click. */}
      {readOnly && <ReadOnlyPill />}
    </div>
  );
}
```

The `Tldraw` component renders its own full chrome (toolbar on the left,
style panel on the right, mini-map / share / help on the corners) inside
its container. Our app's TopBar and TabBar sit above; tldraw's chrome
nests cleanly inside the remaining flex space.

### Theme integration

tldraw has its own light/dark color scheme controlled via
`editor.user.updateUserPreferences({ colorScheme })`. We bridge it to our
`usePrefs().theme`:

```ts
export function useTldrawTheme() {
  const theme = usePrefs((s) => s.theme);
  // resolve "system" to actual mode
  const resolved = useResolvedTheme(theme);
  return { theme: resolved };
}
```

A small effect inside `DrawingTab` watches `theme` and calls
`editor.user.updateUserPreferences` whenever it changes. This keeps the
drawing surface and the rest of the app in visual sync without
requiring tldraw to read our CSS variables.

tldraw exposes a few CSS variables for canvas background and panel
colors. We do not override them in MVP — the default tldraw look-and-feel
is intentionally distinct and signals "this is a different surface."
Post-MVP we may map a small subset (`--color-canvas`, panel border) onto
our token system if visual harmony becomes important.

### Read-only enforcement

The same `onAuthenticate` flow that powers Tab read-only enforcement
applies: when `link_can_edit=false` and the user isn't owner, the
provider receives `readOnly: true`. The drawing tab translates this
into tldraw's `isReadonly` instance state, which:

- hides the editing chrome (toolbar, style panel)
- disables shape creation and modification
- still allows pan / zoom / shape selection (read-only viewing UX)

Server-side, Hocuspocus still drops update messages from `readOnly`
connections, so even if a malicious client patched `isReadonly` in
devtools the server would refuse the writes.

### Persistence

Identical to Tab persistence — `tab_documents.state` bytea, keyed on
tab id. The Hocuspocus `Database` extension's
`fetchDocument(tabId)` / `storeDocument(tabId, state)` callbacks don't
care that the document contains a tldraw `Y.Map` instead of a Y.Text;
both encode/decode via `Y.encodeStateAsUpdate` / `Y.applyUpdate`.

A new drawing tab's `tab_documents` row doesn't exist yet on first open;
`fetchDocument` returns `null`; Hocuspocus initializes an empty Y.Doc;
the binding hydrates an empty store; the user starts with a blank canvas.
First save happens on the first edit's debounce.

### Tab list integration

The drawing tab is just another row in the `tabs` table:

```sql
INSERT INTO tabs (room_id, type, language, name, ordinal)
VALUES ($1, 'drawing', NULL, 'Drawing', $next_ordinal)
```

Defaults:
- `name`: `"Drawing"` (auto-numbered as `"Drawing 2"`, `"Drawing 3"` if
  multiple — same convention as Tab-type tabs)
- `language`: `NULL` (the schema CHECK constraint enforces this for
  drawing rows)
- `ordinal`: max + 1, same as Tab-type creation

The `+` popover in the TabBar (see `realtime-markdown.md` "Tab CRUD"
and "Editor" sections for the popover and TabBar implementation) shows
two options:
- **Tab** — `FileText` icon — "Text, code, or markdown"
- **Drawing** — `PenLine` icon — "Whiteboard canvas"

Picking "Drawing" sends `POST /api/rooms/:slug/tabs` with
`{ type: "drawing" }`, ignoring `language`.

Tab icons in the strip:
- `tab` with `language=markdown` → `FileText`
- `tab` with any other (or null) language → `Code2`
- `drawing` → `PenLine`

(Defined in `components/tabs/tab-icons.ts`.)

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Library | tldraw | Production-grade collaborative whiteboard component; built-in toolbar, tools, undo/redo, mobile/touch, accessibility; far ahead of any hand-rolled canvas in the prototype |
| Sync transport | Hocuspocus + Yjs (not `@tldraw/sync`) | Reuse the same WS infrastructure as Tab content; one auth path, one persistence path, one set of hooks |
| tldraw ↔ Yjs glue | Official integration pattern: `Y.Map<TLRecord>` writing through tldraw's `TLStore` listen / mergeRemoteChanges | Documented by tldraw; minimal custom code; keeps tldraw upgrade-friendly |
| Chrome | Default tldraw UI | Matches every "polished collaborative whiteboard" expectation users have; no custom toolbar to maintain; drops the prototype's hand-rolled minimal toolbar in favor of a more powerful surface |
| Theme | Bridge `usePrefs().theme` to tldraw's `colorScheme` | Visual sync with the rest of the app without overriding tldraw's internal CSS |
| Read-only | tldraw `isReadonly` instance state + Hocuspocus protocol-layer drop | Two-layer enforcement; UI hides editing affordances; server refuses writes |
| Persistence schema | Reuse `tab_documents.state` bytea | One column, two payload shapes (Y.Text-shaped or Y.Map-shaped); the on-disk binary doesn't care |
| Bundle | Lazy-loaded via `React.lazy` per drawing tab | ~500KB only paid by users who open a drawing |
| First-tab seed | None for drawings | The "welcome" seed in realtime-markdown is markdown-only; drawing tabs start blank |
| Cursor presence | Out of scope (matches editor cursor non-goal) | Tldraw can show cursors but we keep presence at the TopBar avatar level for consistency with Tab tabs |

## Rejected Alternatives

- **Excalidraw** — also collaborative, lighter than tldraw, hand-drawn
  aesthetic. Style is more sketchy than what the prototype's design
  language suggests; tldraw's polish matches Rumi better. Excalidraw's
  Yjs integration is also less first-class.
- **Hand-roll the prototype's canvas** — port `DrawingCanvas.tsx` to the
  app and sync via a Y.Array of shapes. Maximum prototype fidelity but
  the prototype is missing select-and-move, undo/redo, layered
  z-ordering, text inline editing, mobile/touch, accessibility, exports,
  and a hundred other things tldraw gets right. Hand-rolling is a
  perpetual maintenance tax for a feature that's not the headline.
- **`@tldraw/sync` server (separate WS infra)** — would mean running two
  WebSocket servers in production, two auth paths, two persistence
  layers, two failure modes. Reusing Hocuspocus for both is the right
  call.
- **Use tldraw's local-only mode and sync with our own Y.Map shape
  layer** — same outcome as the chosen path but with more bespoke
  glue; tldraw's official Yjs pattern is what we use.
- **Map tldraw CSS variables onto our token system** — visual harmony
  is nice but tldraw has hundreds of internal CSS variables; mapping a
  meaningful subset is its own design exercise. Default tldraw look
  ships in MVP; harmonization is a polish pass.
- **Skip drawing entirely until post-MVP** — earlier docs deferred this.
  User has reaffirmed it's MVP. Reverted.
- **In-canvas cursor presence** — tldraw supports it via
  awareness states; could add later. Out of MVP scope; consistent with
  Tab editor cursor non-goal.

## Edge Cases & Constraints

- **Concurrent first-open of a new drawing tab.** Same as Tab: Hocuspocus
  serializes `onLoadDocument` per tab id; both clients share the
  hydrated empty doc.
- **Concurrent shape creation.** Two users draw simultaneously. Y.Map's
  per-key LWW means each shape (keyed by tldraw shape id, which is
  client-generated UUID) is independent — both shapes appear. No
  conflict.
- **Concurrent edit of the same shape.** Two users drag the same shape
  at the same time. Last write wins per shape record. Visible jitter
  while dragging is possible; final position converges to the last
  user to release.
- **Deleting a shape while another user edits it.** Y.Map delete vs
  set: tldraw observes the delete and removes the record locally; the
  setter's update arrives after the delete and re-creates the shape
  with the new field values. Result: shape comes back. Acceptable for
  MVP; the alternative (tracking tombstones) is post-MVP.
- **Undo/redo across users.** tldraw's local undo stack is per-user.
  Yjs has its own `Y.UndoManager` for Y.Text but binding it to
  tldraw's reactive store is non-trivial and post-MVP.
- **Theme switch mid-session.** The effect on `theme` calls
  `editor.user.updateUserPreferences({ colorScheme })`. Tldraw recolors
  immediately; no remount.
- **Large drawings.** Y.Map values are full record snapshots, not
  diffs. A drawing with thousands of shapes accumulates Y.Map history
  internally; `Y.encodeStateAsUpdate` compaction (Hocuspocus default)
  keeps stored bytes bounded. In-memory growth is the same risk as
  any large Yjs doc; documented and not optimized in MVP.
- **Read-only flip mid-session.** When the owner flips
  `link_can_edit=false`, all WS connections drop and reconnect. On
  reconnect, `isReadonly` is set; tldraw chrome updates; in-flight
  shape edits stop. Tldraw doesn't have a graceful "lock" animation;
  the editor just becomes read-only.
- **Tab type immutability.** A user cannot change a `drawing` tab into
  a `tab` (or vice versa). PATCH endpoint rejects type changes. To
  switch surfaces, the user creates a new tab and closes the old one.
  This avoids data-shape conversion (Y.Map of TLRecords → Y.Text or
  vice versa), which has no sensible automatic mapping.
- **Bundle cost on first drawing tab open.** Lazy-loaded; first open
  shows the editor skeleton until the chunk loads (a few hundred ms on
  a fast connection). Acceptable; tldraw bundle is an unavoidable
  cost for the feature.
- **Mobile drawing.** Tldraw handles touch and stylus by default. We
  inherit this; no extra work.
- **Tldraw asset uploads (drag-image-onto-canvas).** Default tldraw
  configuration tries to upload pasted/dragged images via its asset
  pipeline, which requires a backend handler. We wire a tldraw
  asset handler that **rejects** uploads in MVP (tldraw shows a
  "couldn't upload" toast). Post-MVP we either disable the affordance
  cleanly or wire Supabase Storage. Documented as a deliberate
  rejection in MVP, not a bug.

## Testing

Server-side: nothing drawing-specific. The `tab_documents` round-trip
test (`db/documents-roundtrip.test.ts` from realtime-markdown) covers
binary persistence regardless of payload shape. The tabs CRUD test
asserts that POST with `type='drawing'` and a non-null `language` is
rejected (already in `rooms/tabs.routes.test.ts`).

Client-side:

- `lib/drawing/yjs-store.test.ts` — pure unit test of the binding:
  - Hydrate from non-empty Y.Map populates the store.
  - Local store add → Y.Map gets the record with the right id.
  - Remote Y.Map set → store gets the record.
  - Remote Y.Map delete → store loses the record.
  - Local change with origin tag does not feed back through the
    observe path.
  - Two concurrent local stores connected via a shared in-memory
    Y.Doc converge after a few transactions.

- `drawing-tab.test.tsx` — render with a mocked `useTabDoc` returning
  a stub Y.Doc + provider; assert the `<Tldraw>` mount happens, the
  store is created, theme prop flows through. Tldraw is heavy in
  tests; the mount test mocks the `Tldraw` component to avoid
  pulling tldraw's full DOM.

- `drawing-readonly.test.tsx` — `useTabDoc` returns `readOnly: true`;
  assert tldraw `updateInstanceState({ isReadonly: true })` was called
  and the read-only pill renders.

Manual verification (run after execute):

1. Open a room, click `+` → "Drawing". A new drawing tab appears with
   tldraw chrome (toolbar left, style panel right, default empty
   canvas).
2. Draw a rectangle and a freehand stroke. Switch to a Tab tab and
   back. The drawing is intact.
3. Open the same room in a second browser as a second user. Both
   users open the drawing tab. Draw on one window; the other shows
   the strokes within ~50ms.
4. Move a shape on window A. Window B sees it move. Move the same
   shape on window B simultaneously — verify final position converges
   to whichever user released last.
5. Delete all shapes on A; B sees the canvas clear.
6. Refresh both browsers. The drawing reloads from persistence.
7. Owner toggles `link_can_edit=false`. The non-owner's drawing tab
   reconnects in read-only mode; tldraw chrome hides; pan/zoom still
   works; click-to-create does nothing; "Read only" pill is visible.
8. Switch theme between light and dark. Tldraw recolors immediately
   in both windows.
9. Drag an image file onto the canvas. Verify tldraw shows a "couldn't
   upload" toast (asset rejection working as designed).
10. Delete the drawing tab. Verify tldraw unmounts cleanly; the tab
    disappears from the strip on both windows; `tab_documents` row
    is cleaned up by the FK cascade.

## Open Questions

None.

## Notes for sync-docs

- The `tabs` table's `type='drawing'` rows and the CHECK constraint on
  `language IS NULL for drawing` are documented in SPEC.md (this pass).
- Tldraw library choice is in SPEC.md's Key Decisions table (this pass).
- No further sync-docs work pending from this design doc.

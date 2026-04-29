# Drawing Tab Plan

> **Goal:** Add the `drawing` tab type to the room — a tldraw whiteboard bound to a per-tab Yjs Y.Doc, syncing through the same Hocuspocus infrastructure built in `realtime-markdown-plan.md`.
> **Spec:** [docs/SPEC.md](../SPEC.md)
> **Design:** [docs/designs/drawing.md](../designs/drawing.md)
> **Depends on:** `realtime-markdown-plan.md` complete (`tab_documents` table + persistence wrapper, Hocuspocus + auth hook + per-tab `closeConnections`, tab CRUD endpoints, control-doc broadcasts, tab bar with `+` popover offering Tab and Drawing, `useTabDoc` hook).

> **Lint convention:** Same `as any` rule as auth-and-rooms / realtime-markdown — add `// biome-ignore lint/suspicious/noExplicitAny: <reason>` above each cast.

---

## Task 1: Install tldraw

- **What:** Add the tldraw component package to the web workspace.
- **Why:** This is the entire feature surface — tldraw renders the canvas, ships its own toolbar/tools/undo/redo, and exposes a `TLStore` we bridge to Yjs.
- **How:**
  - Pin a specific tldraw version at execute time (tldraw is on a fast release cadence; pinning protects against breaking-change surprises). At time of writing, `tldraw@^3.0.0` is current. Confirm before install.
  - **`apps/web/`:**
    - Add to `dependencies`: `tldraw` (latest stable minor as of execute time).
  - Run `bun install` from repo root.
- **Verify:**
  - `bun install` exits 0.
  - `apps/web/package.json` lists `tldraw` with the pinned version.
  - `bun run typecheck` from root passes.

---

## Task 2: Web — tldraw ↔ Yjs binding

- **What:** `lib/drawing/yjs-store.ts` — pure functions that wire a tldraw `TLStore` to a Y.Doc's `Y.Map<TLRecord>`.
- **Why:** Isolated, testable, framework-agnostic. The React mount in Task 3 just calls this once per tab and consumes the resulting store.
- **How:**
  - Create `apps/web/src/lib/drawing/yjs-store.ts`:
    ```ts
    import * as Y from "yjs";
    import type { TLRecord, TLSchema, TLStore } from "tldraw";
    import { createTLStore } from "tldraw";

    export function createYjsStore({
      doc,
      schema,
    }: { doc: Y.Doc; schema: TLSchema }): TLStore {
      const yShapes = doc.getMap<TLRecord>("tldraw");
      const store = createTLStore({ schema });

      // 1. Initial hydrate from the Y.Map into the store.
      store.mergeRemoteChanges(() => {
        for (const record of yShapes.values()) {
          store.put([record]);
        }
      });

      // 2. Local store changes → write into the Y.Map.
      const unlisten = store.listen(
        ({ changes }) => {
          doc.transact(() => {
            for (const r of Object.values(changes.added)) yShapes.set(r.id, r);
            for (const [, r] of Object.values(changes.updated)) yShapes.set(r.id, r);
            for (const r of Object.values(changes.removed)) yShapes.delete(r.id);
          }, "local");
        },
        { source: "user", scope: "document" },
      );

      // 3. Remote Y.Map changes → apply into the store.
      const observer = (event: Y.YMapEvent<TLRecord>, txn: Y.Transaction) => {
        if (txn.origin === "local") return; // skip our own writes
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
      };
      yShapes.observe(observer);

      // Cleanup on store dispose. Tldraw's TLStore exposes a `dispose` lifecycle.
      const originalDispose = store.dispose.bind(store);
      store.dispose = () => {
        unlisten();
        yShapes.unobserve(observer);
        originalDispose();
      };

      return store;
    }
    ```
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `apps/web/src/lib/drawing/yjs-store.test.ts` covers:
    - Hydrate from non-empty Y.Map populates the store.
    - Local store add → Y.Map gets the record with the right id.
    - Remote Y.Map set → store gets the record (origin tagging skips self-feedback).
    - Remote Y.Map delete → store loses the record.
    - Two stores connected via a shared in-memory Y.Doc converge after a few transactions.
  - `bun test apps/web/src/lib/drawing/yjs-store.test.ts` passes.

---

## Task 3: Web — `<DrawingTab />` component

- **What:** `components/editor/drawing-tab.tsx` — mounts `<Tldraw>` with the Yjs-bound store, bridges theme prefs, and applies the read-only flag.
- **Why:** This is the React layer the `<TabEditor>` switch (built in `realtime-markdown-plan.md` Task 11) routes to when `tab.type === "drawing"`.
- **How:**
  - Lazy-load via `React.lazy` so users who never open a drawing tab don't pay tldraw's ~500KB bundle:
    ```tsx
    // In tab-editor.tsx (already exists from realtime-markdown-plan):
    const DrawingTab = lazy(() => import("./drawing-tab"));

    // In the type === 'drawing' branch:
    <Suspense fallback={<EditorSkeleton />}>
      <DrawingTab tab={tab} />
    </Suspense>
    ```
  - Create `apps/web/src/components/editor/drawing-tab.tsx`:
    ```tsx
    import {
      Tldraw,
      createTLSchema,
      defaultShapeUtils,
      type Editor,
      type TLAssetStore,
    } from "tldraw";
    import "tldraw/tldraw.css";
    import { useEffect, useMemo, useRef } from "react";
    import { useTabDoc } from "./use-tab-doc";
    import { useTldrawTheme } from "@/lib/drawing/theme";
    import { createYjsStore } from "@/lib/drawing/yjs-store";
    import { EditorSkeleton } from "./editor-skeleton";
    import { ReadOnlyPill } from "./read-only-pill";
    import type { TabSummary } from "@rumi/protocol";

    // Reject all asset uploads in MVP — we don't have a storage backend wired.
    // Tldraw shows its own "couldn't upload" toast when this throws.
    const rejectingAssetStore: TLAssetStore = {
      async upload() {
        throw new Error("Asset uploads are not supported yet");
      },
      resolve(asset) {
        return asset.props.src ?? null;
      },
    };

    export default function DrawingTab({ tab }: { tab: TabSummary }) {
      const { ydoc, provider, readOnly } = useTabDoc({ tabId: tab.id });
      const { theme } = useTldrawTheme();
      const editorRef = useRef<Editor | null>(null);

      const store = useMemo(() => {
        if (!ydoc) return null;
        return createYjsStore({
          doc: ydoc,
          schema: createTLSchema({ shapeUtils: defaultShapeUtils }),
        });
      }, [ydoc]);

      // Cleanup the store when the tab unmounts.
      useEffect(() => {
        return () => store?.dispose();
      }, [store]);

      // Push theme into tldraw whenever it changes mid-session.
      useEffect(() => {
        editorRef.current?.user.updateUserPreferences({ colorScheme: theme });
      }, [theme]);

      // Push readOnly into tldraw whenever it changes (e.g. owner flips
      // link_can_edit while the user is viewing).
      useEffect(() => {
        editorRef.current?.updateInstanceState({ isReadonly: readOnly });
      }, [readOnly]);

      if (!provider || !store) return <EditorSkeleton />;

      return (
        <div className="relative h-full">
          <Tldraw
            store={store}
            assets={rejectingAssetStore}
            autoFocus
            inferDarkMode={false}
            onMount={(editor) => {
              editorRef.current = editor;
              editor.user.updateUserPreferences({ colorScheme: theme });
              editor.updateInstanceState({ isReadonly: readOnly });
            }}
          />
          {readOnly && <ReadOnlyPill />}
        </div>
      );
    }
    ```
    Notes:
    - `Editor` is the live editor handle exposed by tldraw v3's `<Tldraw onMount>` callback. Confirm the export name at execute time against the pinned tldraw version.
    - Storing the editor in a ref (rather than state) avoids re-renders on every theme/readOnly flip; the effects use the ref to push imperative updates.
  - Create `apps/web/src/lib/drawing/theme.ts`:
    ```ts
    import { useTheme } from "next-themes";
    import { usePrefs } from "@/lib/prefs";
    import { useEffect, useState } from "react";

    type Resolved = "light" | "dark";

    export function useTldrawTheme(): { theme: Resolved } {
      const prefsTheme = usePrefs((s) => s.theme);
      const { resolvedTheme } = useTheme();
      const [theme, setTheme] = useState<Resolved>(
        (resolvedTheme as Resolved) ?? "dark",
      );
      useEffect(() => {
        if (prefsTheme === "system") {
          setTheme((resolvedTheme as Resolved) ?? "dark");
        } else {
          setTheme(prefsTheme);
        }
      }, [prefsTheme, resolvedTheme]);
      return { theme };
    }
    ```
  - Create `apps/web/src/components/editor/read-only-pill.tsx`:
    ```tsx
    export function ReadOnlyPill() {
      return (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning shadow-xs">
          Read only
        </div>
      );
    }
    ```
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `apps/web/src/components/editor/drawing-tab.test.tsx` — render with `useTabDoc` mocked to return a stub Y.Doc + provider. Mock the `Tldraw` React component to avoid pulling tldraw's full DOM into bun-test. Assert the store is created and `onMount` would receive the resolved theme + readOnly.
  - `apps/web/src/components/editor/drawing-readonly.test.tsx` — `useTabDoc` returns `readOnly: true`; assert `<ReadOnlyPill />` renders.
  - `bun test apps/web/src/components/editor/drawing-tab.test.tsx` and `drawing-readonly.test.tsx` pass.

---

## Task 4: Manual verification flow + pre-commit gate

- **What:** Manual end-to-end of the drawing tab, then the pre-commit gate.
- **Why:** Tldraw's CRDT-friendliness and our Yjs binding both have edge cases mocked tests can't fully exercise.
- **How:**
  - Sign in, open or create a room (Welcome tab is a markdown Tab).
  - Click `+` → "Drawing" — a new tab named "Drawing" appears with tldraw chrome (toolbar left, style panel right, mini-map bottom-left, blank canvas in the center).
  - Draw a rectangle, a freehand stroke, an arrow, and add some text. Switch back to the Welcome tab; switch to the drawing again. The drawing is intact.
  - Open the same room URL in a second browser as a different signed-in user. Both users open the drawing tab.
  - Draw on window A → window B sees the strokes within ~50ms.
  - Move a shape on A → B sees it move. Move the same shape on B simultaneously — final position resolves to whichever user released last (LWW per shape record).
  - Delete all shapes on A → B's canvas clears.
  - Refresh both browsers — drawing reloads from persistence.
  - Owner PATCHes `link_can_edit=false` (curl, same as realtime-markdown's manual flow). Non-owner's drawing tab reconnects in read-only mode: chrome hides, pan/zoom still works, click-to-create does nothing, "Read only" pill appears top-right.
  - Switch theme between light and dark via the TopBar settings dropdown. Tldraw recolors immediately in both windows.
  - Drag an image file onto the canvas. Verify tldraw shows a "couldn't upload" toast (asset rejection working as designed).
  - Delete the drawing tab via the close button (visible on hover; only visible if there are at least 2 tabs in the room). Verify tldraw unmounts cleanly; tab disappears from the strip on both windows; the `tab_documents` row is cleaned up by the FK cascade (verify in Supabase Studio).
  - Confirm the 3-tab cap still applies — try adding a 4th tab (mix of types). The `+` button is disabled.
  - Pre-commit gate from repo root:
    - `bun run check`
    - `bun run typecheck`
    - `bun test apps packages`
- **Verify:** All manual steps succeed without errors. All three commands exit 0.

---

## Suggested commit points

- **After Task 3** (drawing-tab component renders against a stub provider) — UI shipping checkpoint.
- **After Task 4** (manual verification + pre-commit gate green) — full phase complete.

Single-commit also fine: this phase is "feat: drawing tab (tldraw + yjs sync)."

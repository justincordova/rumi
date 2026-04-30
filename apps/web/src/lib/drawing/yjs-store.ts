import { type Editor, type TLRecord, createTLStore } from "tldraw";
import type * as Y from "yjs";

export type YjsBoundStore = ReturnType<typeof createTLStore>;

const LOCAL_ORIGIN = Symbol("yjs-store-local");

/**
 * Creates a TLStore wired to a Y.Doc's `"tldraw"` Y.Map.
 *
 * Returns:
 *   - `store`: a fresh TLStore. Pass this to `<Tldraw store={store} />`.
 *   - `bind(editor)`: call from `Tldraw.onMount` to attach the local-change
 *     listener via `editor.store.listen`. Returns a teardown function which
 *     tldraw will invoke on unmount.
 *
 * Why split it: `store.listen` does not reliably fire on a standalone TLStore
 * before the Editor mounts and takes ownership. Attaching the listener from
 * inside `onMount` — using `editor.store.listen` on the same store — is the
 * canonical pattern.
 */
export function createYjsStore({ doc }: { doc: Y.Doc }): {
  store: YjsBoundStore;
  bind: (editor: Editor) => () => void;
} {
  const yShapes = doc.getMap<TLRecord>("tldraw");
  const store = createTLStore();

  // Hydrate from whatever the Y.Map already has.
  store.mergeRemoteChanges(() => {
    for (const record of yShapes.values()) {
      store.put([record]);
    }
  });

  // Remote -> local: Y.Map updates flow into the store.
  // Local writes are tagged with LOCAL_ORIGIN so the observer ignores them.
  const observer = (event: Y.YMapEvent<TLRecord>, txn: Y.Transaction) => {
    if (txn.origin === LOCAL_ORIGIN) return;
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

  let observerDetached = false;
  const detachObserver = () => {
    if (observerDetached) return;
    observerDetached = true;
    yShapes.unobserve(observer);
  };

  // Local -> remote: attached after the Editor mounts. Returns a teardown.
  const bind = (editor: Editor): (() => void) => {
    const unlisten = editor.store.listen(
      ({ changes }) => {
        doc.transact(() => {
          for (const r of Object.values(changes.added)) yShapes.set(r.id, r);
          for (const [, r] of Object.values(changes.updated)) yShapes.set(r.id, r);
          for (const r of Object.values(changes.removed)) yShapes.delete(r.id);
        }, LOCAL_ORIGIN);
      },
      { source: "user", scope: "document" },
    );
    return () => {
      unlisten();
    };
  };

  // Tear down the observer when the store itself is disposed (tab unmount).
  const originalDispose = store.dispose.bind(store);
  store.dispose = () => {
    detachObserver();
    originalDispose();
  };

  return { store, bind };
}

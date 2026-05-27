import { type Editor, type TLRecord, createTLStore } from "tldraw";
import { YKeyValue } from "y-utility/y-keyvalue";
import type * as Y from "yjs";

export type YjsBoundStore = ReturnType<typeof createTLStore>;

/**
 * Creates a TLStore wired to a Y.Doc via a YKeyValue (Y.Array-backed key-value
 * store). This follows the canonical tldraw + Yjs binding pattern published in
 * `tldraw/tldraw-yjs-example`.
 *
 * Returns:
 *   - `store`: a fresh TLStore. Pass to `<Tldraw store={store} />`.
 *   - `bind(editor, opts)`: call from `Tldraw.onMount` AFTER the provider has
 *     emitted "synced". Returns a teardown function for tldraw to call on
 *     unmount. Wiring up the local→Y listener before the initial sync would
 *     cause every fresh client to overwrite the persisted state with their
 *     own local defaults (`document`, `instance`, `page`, etc.) — which is
 *     why the previous Y.Map-based implementation lost drawings on refresh
 *     and didn't sync between peers.
 *
 * Why YKeyValue (not Y.Map): Y.Map performs poorly when the same keys are
 * frequently updated in alternating order (which is exactly tldraw's pointer
 * + camera + shape update pattern). YKeyValue stores `{ key, val }` pairs in a
 * Y.Array and emits proper per-key add/update/delete change events with both
 * old and new values. See the y-utility source for details.
 */
export function createYjsStore({ doc }: { doc: Y.Doc }): {
  store: YjsBoundStore;
  yStore: YKeyValue<TLRecord>;
  bind: (editor: Editor) => () => void;
} {
  // The Yjs root key acts as a schema version for the shared drawing state.
  // Earlier code stored records in a Y.Map under the name "tldraw"; the
  // current binding requires a Y.Array (via YKeyValue). Re-using the same
  // name across types throws at runtime ("Type with name X already defined
  // with a different constructor") whenever a Y.Doc with the old structure
  // is loaded from persistence. Bump the suffix when the shared schema
  // changes incompatibly.
  const yArr = doc.getArray<{ key: string; val: TLRecord }>("tldraw-v2");
  const yStore = new YKeyValue<TLRecord>(yArr);
  const store = createTLStore();

  const bind = (editor: Editor): (() => void) => {
    // Hydrate the store from whatever YKeyValue currently has. This runs
    // AFTER the provider's initial sync has populated yStore, so we get the
    // server's authoritative state — not the local defaults.
    //
    // For a brand-new room with no drawings yet, yStore.yarray is empty —
    // in that case we MUST leave the freshly-created TLStore's local
    // defaults (document, page, instance) in place, otherwise tldraw
    // renders blank/broken because it lost the records it needs to
    // bootstrap. Only wipe-and-replace when we have actual remote records
    // to populate with.
    const remoteRecords: TLRecord[] = [];
    for (const { val } of yStore.yarray) {
      remoteRecords.push(val);
    }
    if (remoteRecords.length > 0) {
      store.mergeRemoteChanges(() => {
        const localDefaults = store.allRecords();
        if (localDefaults.length > 0) {
          store.remove(localDefaults.map((r) => r.id));
        }
        store.put(remoteRecords);
      });
    }

    const unsubs: Array<() => void> = [];

    // Local store changes -> YKeyValue.
    unsubs.push(
      editor.store.listen(
        ({ changes }) => {
          doc.transact(() => {
            for (const r of Object.values(changes.added)) {
              yStore.set(r.id, r);
            }
            for (const [, r] of Object.values(changes.updated)) {
              yStore.set(r.id, r);
            }
            for (const r of Object.values(changes.removed)) {
              yStore.delete(r.id);
            }
          });
        },
        { source: "user", scope: "document" },
      ),
    );

    // YKeyValue changes -> local store. `transaction.local === true` means
    // the change originated from THIS client's `doc.transact(...)` call
    // above, so we skip it to avoid an echo. Remote updates applied by the
    // HocuspocusProvider have `transaction.local === false`.
    const handleChange = (
      changes: Map<
        string,
        | { action: "delete"; oldValue: TLRecord }
        | { action: "update"; oldValue: TLRecord; newValue: TLRecord }
        | { action: "add"; newValue: TLRecord }
      >,
      transaction: Y.Transaction,
    ) => {
      if (transaction.local) return;

      const toRemove: TLRecord["id"][] = [];
      const toPut: TLRecord[] = [];

      changes.forEach((change, id) => {
        if (change.action === "delete") {
          toRemove.push(id as TLRecord["id"]);
        } else {
          const record = yStore.get(id);
          if (record) toPut.push(record);
        }
      });

      store.mergeRemoteChanges(() => {
        if (toRemove.length) store.remove(toRemove);
        if (toPut.length) store.put(toPut);
      });
    };

    yStore.on("change", handleChange);
    unsubs.push(() => yStore.off("change", handleChange));

    return () => {
      for (const fn of unsubs) fn();
    };
  };

  return { store, yStore, bind };
}

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { type Editor, InstancePresenceRecordType, type TLInstancePresence } from "tldraw";

/** Throttle in ms between awareness updates from local pointer movement. */
const POINTER_THROTTLE_MS = 75;

/**
 * Wire a tldraw editor to a Hocuspocus provider for **cursor-only** presence.
 *
 * - Subscribes to the editor's pointer position and writes it to the local
 *   awareness state on a leading-edge throttle (~75ms).
 * - Mirrors remote awareness states into the editor's store as
 *   `TLInstancePresence` records. tldraw renders the cursors automatically.
 *
 * Camera, selection, and other presence dimensions stay local to each user
 * (cursor-only v1 — see docs/designs/pre-launch-hardening.md §4.1).
 *
 * Returns a cleanup function. Safe to call when readOnly: the local pointer
 * subscription is skipped, but remote cursors still render.
 */
export function bindCursorPresence({
  editor,
  provider,
  readOnly,
}: {
  editor: Editor;
  provider: HocuspocusProvider;
  readOnly: boolean;
}): () => void {
  const awareness = provider.awareness;
  if (!awareness) return () => {};

  const cleanups: Array<() => void> = [];

  // ── Outbound: throttle local pointer → awareness ─────────────────────────
  if (!readOnly) {
    let lastSent = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;

    const send = () => {
      lastSent = Date.now();
      const point = editor.inputs.currentPagePoint;
      const pageId = editor.getCurrentPageId();
      awareness.setLocalStateField("cursor", {
        x: point.x,
        y: point.y,
        pageId,
      });
    };

    const onChange = () => {
      const now = Date.now();
      const since = now - lastSent;
      if (since >= POINTER_THROTTLE_MS) {
        if (pending) {
          clearTimeout(pending);
          pending = null;
        }
        send();
      } else if (!pending) {
        pending = setTimeout(() => {
          pending = null;
          send();
        }, POINTER_THROTTLE_MS - since);
      }
    };

    // tldraw's "change" event fires on every editor mutation including pointer moves.
    editor.on("change", onChange);
    cleanups.push(() => {
      editor.off("change", onChange);
      if (pending) clearTimeout(pending);
      // Clear our cursor so peers don't see a stale ghost cursor.
      awareness.setLocalStateField("cursor", null);
    });
  }

  // ── Inbound: remote awareness → tldraw store ─────────────────────────────
  const presenceIds = new Map<number, ReturnType<typeof InstancePresenceRecordType.createId>>();

  const sync = () => {
    const states = awareness.getStates();
    const liveClientIds = new Set<number>();

    for (const [clientId, state] of states) {
      if (clientId === awareness.clientID) continue; // Skip our own state.
      const userId = state.user_id as string | undefined;
      const cursor = state.cursor as { x: number; y: number; pageId: string } | null | undefined;
      if (!userId || !cursor) continue;

      liveClientIds.add(clientId);

      let presenceId = presenceIds.get(clientId);
      if (!presenceId) {
        presenceId = InstancePresenceRecordType.createId(userId);
        presenceIds.set(clientId, presenceId);
      }

      // Only render the cursor when the remote user is on the page we're viewing.
      if (cursor.pageId !== editor.getCurrentPageId()) {
        editor.store.remove([presenceId]);
        continue;
      }

      const userName = (state.display_name as string | undefined) ?? "Anonymous";
      const color = (state.color as string | undefined) ?? "#666";

      const record: TLInstancePresence = InstancePresenceRecordType.create({
        id: presenceId,
        userId,
        userName,
        color,
        currentPageId: editor.getCurrentPageId(),
        cursor: { x: cursor.x, y: cursor.y, type: "default", rotation: 0 },
        lastActivityTimestamp: Date.now(),
      });
      editor.store.put([record]);
    }

    // Drop presence records for clients that are no longer broadcasting.
    for (const [clientId, id] of presenceIds) {
      if (!liveClientIds.has(clientId)) {
        editor.store.remove([id]);
        presenceIds.delete(clientId);
      }
    }
  };

  awareness.on("change", sync);
  // Re-sync when the local user changes pages so we drop off-page cursors.
  // `editor.on("change")` fires for EVERY store mutation — including the
  // presence records `sync()` itself writes (each with a fresh
  // `lastActivityTimestamp`). Calling `sync()` unconditionally here would feed
  // back into itself (put → change → onPageChange → sync → put …) and spin a
  // busy loop whenever a remote cursor is on the page. Gate on an actual page
  // change so our own presence writes don't re-trigger a sync.
  let lastPageId = editor.getCurrentPageId();
  const onPageChange = () => {
    const current = editor.getCurrentPageId();
    if (current === lastPageId) return;
    lastPageId = current;
    sync();
  };
  editor.on("change", onPageChange);
  sync();

  cleanups.push(() => {
    awareness.off("change", sync);
    editor.off("change", onPageChange);
    // Clean up any presence records we put in the store.
    for (const id of presenceIds.values()) editor.store.remove([id]);
    presenceIds.clear();
  });

  return () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        // best-effort
      }
    }
  };
}

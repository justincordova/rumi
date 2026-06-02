import { env } from "@/lib/env";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

export type Status = "connecting" | "connected" | "disconnected";

export interface CacheEntry {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  statusListeners: Set<(s: Status) => void>;
  readOnlyListeners: Set<(r: boolean) => void>;
  refCount: number;
  pendingDestroy: ReturnType<typeof setTimeout> | null;
}

// Module-level cache keyed by `${kind}|${name}|${token}`. React StrictMode dev
// mode synchronously unmounts and remounts components; without a cache we'd
// destroy and recreate the Y.Doc + provider on every mount, racing against
// WebSocket sync and orphaning observers (notably tldraw's). Reference
// counting + a deferred destroy lets the immediate remount reuse the live
// instance.
const cache = new Map<string, CacheEntry>();

export function acquireDoc(opts: {
  key: string;
  documentName: string;
  token: string;
  onStatus: (s: Status) => void;
  onReadOnly: (r: boolean) => void;
}): CacheEntry {
  const { key, documentName, token, onStatus, onReadOnly } = opts;
  const existing = cache.get(key);
  if (existing) {
    if (existing.pendingDestroy) {
      clearTimeout(existing.pendingDestroy);
      existing.pendingDestroy = null;
    }
    existing.refCount += 1;
    existing.statusListeners.add(onStatus);
    existing.readOnlyListeners.add(onReadOnly);
    // Replay current status so a late subscriber gets up-to-date state.
    if (existing.provider.status) {
      onStatus(existing.provider.status as Status);
    }
    return existing;
  }

  // Use the Zod-validated env from `@/lib/env` rather than reading
  // `import.meta.env` directly, so a misconfigured VITE_WS_URL (e.g. empty
  // string) fails at app boot instead of silently falling back to localhost
  // in production.
  const wsUrl = env.VITE_WS_URL;
  const ydoc = new Y.Doc();
  const statusListeners = new Set<(s: Status) => void>([onStatus]);
  const readOnlyListeners = new Set<(r: boolean) => void>([onReadOnly]);

  const provider = new HocuspocusProvider({
    url: wsUrl,
    name: documentName,
    token,
    // Surface a NON-SECRET presence flag (not the token value) as a URL query
    // param so the server's pre-handshake guest rate limiter
    // (`checkGuestRateLimit` / `hasAuthToken`) can tell this is an
    // authenticated upgrade and apply the higher cap. The query string ends up
    // in proxy/LB access logs and browser history, so we must not put the JWT
    // there. Hocuspocus's own auth flow uses the `token` option above (sent as
    // a post-handshake auth message over WSS), which is where the real
    // credential travels.
    parameters: token ? { auth: "1" } : {},
    document: ydoc,
    onStatus: ({ status: s }: { status: Status }) => {
      for (const fn of statusListeners) fn(s);
    },
    onAuthenticated: () => {
      // readOnly arrives via the "session" stateless message sent by the server
      // in the `connected` hook, after auth + sync are complete.
    },
    onStateless: ({ payload }: { payload: string }) => {
      try {
        const msg = JSON.parse(payload) as { type?: string; readOnly?: boolean };
        if (msg.type === "session") {
          for (const fn of readOnlyListeners) fn(!!msg.readOnly);
        }
      } catch {
        // malformed payload — ignore
      }
    },
  });

  const entry: CacheEntry = {
    ydoc,
    provider,
    statusListeners,
    readOnlyListeners,
    refCount: 1,
    pendingDestroy: null,
  };
  cache.set(key, entry);
  return entry;
}

export function releaseDoc(opts: {
  key: string;
  onStatus: (s: Status) => void;
  onReadOnly: (r: boolean) => void;
}) {
  const { key, onStatus, onReadOnly } = opts;
  const entry = cache.get(key);
  if (!entry) return;
  entry.statusListeners.delete(onStatus);
  entry.readOnlyListeners.delete(onReadOnly);
  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  // Defer destroy. If a synchronous remount (StrictMode) re-acquires the same
  // key before this fires, `acquireDoc` clears the timeout.
  entry.pendingDestroy = setTimeout(() => {
    if (entry.refCount === 0) {
      entry.provider.destroy();
      entry.ydoc.destroy();
      cache.delete(key);
    }
  }, 0);
}

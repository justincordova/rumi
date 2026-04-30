import { useSession } from "@/lib/auth";
import { buildLocalAwareness } from "@/lib/collab/awareness";
import { getGuestId } from "@/lib/guest";
import { useEffect, useRef, useState } from "react";
import { type CacheEntry, type Status, acquireDoc, releaseDoc } from "./yjs-doc-cache";

export function useTabDoc({ tabId }: { tabId: string }) {
  const token = useSession((s) => s.token) ?? getGuestId();
  const user = useSession((s) => s.user);
  const [status, setStatus] = useState<Status>("connecting");
  const [readOnly, setReadOnly] = useState(false);
  const entryRef = useRef<CacheEntry | null>(null);
  // Force a render after the cache entry is wired so consumers can read
  // ydoc/provider from the ref.
  const [, setNonce] = useState(0);

  useEffect(() => {
    const key = `tab|${tabId}|${token}`;
    const onStatus = (s: Status) => setStatus(s);
    const onReadOnly = (r: boolean) => setReadOnly(r);
    const entry = acquireDoc({ key, documentName: tabId, token, onStatus, onReadOnly });
    entryRef.current = entry;
    setNonce((n) => n + 1);
    return () => {
      releaseDoc({ key, onStatus, onReadOnly });
      setReadOnly(false);
    };
  }, [tabId, token]);

  // Push awareness whenever the user identity changes, without rebuilding the provider.
  useEffect(() => {
    entryRef.current?.provider.awareness?.setLocalState(buildLocalAwareness(user, getGuestId()));
  }, [user]);

  return {
    ydoc: entryRef.current?.ydoc ?? null,
    provider: entryRef.current?.provider ?? null,
    status,
    readOnly,
  };
}

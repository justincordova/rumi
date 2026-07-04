import { useSession } from "@/lib/auth";
import { buildLocalAwareness } from "@/lib/collab/awareness";
import { getGuestId } from "@/lib/guest";
import { useEffect, useRef, useState } from "react";
import { type CacheEntry, type Status, acquireDoc, releaseDoc } from "./yjs-doc-cache";

export function useRoomControlDoc({ roomId }: { roomId: string }) {
  // Key the cache by the stable identity (userId or guest UUID), never the
  // JWT — token refreshes must not tear down live docs. The provider pulls
  // the current credential via getToken on every (re)connection.
  const userId = useSession((s) => s.user?.id ?? null);
  const user = useSession((s) => s.user);
  // Keep a stable ref to the latest user so the acquire effect can read it
  // without re-running when user changes.
  const userRef = useRef(user);
  userRef.current = user;

  const [status, setStatus] = useState<Status>("connecting");
  const [readOnly, setReadOnly] = useState(false);
  const entryRef = useRef<CacheEntry | null>(null);
  const [, setNonce] = useState(0);

  useEffect(() => {
    const identity = userId ?? getGuestId();
    const key = `room|${roomId}|${identity}`;
    const documentName = `room:${roomId}`;
    const onStatus = (s: Status) => setStatus(s);
    const onReadOnly = (r: boolean) => setReadOnly(r);
    const entry = acquireDoc({
      key,
      documentName,
      getToken: () => useSession.getState().token ?? getGuestId(),
      authed: userId !== null,
      onStatus,
      onReadOnly,
    });
    entryRef.current = entry;
    // Set awareness immediately so it's available as soon as the provider connects.
    entry.provider.awareness?.setLocalState(buildLocalAwareness(userRef.current, getGuestId()));
    setNonce((n) => n + 1);
    return () => {
      releaseDoc({ key, onStatus, onReadOnly });
      setReadOnly(false);
    };
  }, [roomId, userId]);

  // Also update awareness when the user identity changes (e.g. after sign-in).
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

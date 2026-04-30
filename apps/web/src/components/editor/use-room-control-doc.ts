import { useSession } from "@/lib/auth";
import { buildLocalAwareness } from "@/lib/collab/awareness";
import { getGuestId } from "@/lib/guest";
import { useEffect, useRef, useState } from "react";
import { type CacheEntry, type Status, acquireDoc, releaseDoc } from "./yjs-doc-cache";

export function useRoomControlDoc({ roomId, token: tokenProp }: { roomId: string; token: string }) {
  const user = useSession((s) => s.user);
  const [status, setStatus] = useState<Status>("connecting");
  const [readOnly, setReadOnly] = useState(false);
  const entryRef = useRef<CacheEntry | null>(null);
  const [, setNonce] = useState(0);

  useEffect(() => {
    const key = `room|${roomId}|${tokenProp}`;
    const documentName = `room:${roomId}`;
    const onStatus = (s: Status) => setStatus(s);
    const onReadOnly = (r: boolean) => setReadOnly(r);
    const entry = acquireDoc({
      key,
      documentName,
      token: tokenProp,
      onStatus,
      onReadOnly,
    });
    entryRef.current = entry;
    setNonce((n) => n + 1);
    return () => {
      releaseDoc({ key, onStatus, onReadOnly });
      setReadOnly(false);
    };
  }, [roomId, tokenProp]);

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

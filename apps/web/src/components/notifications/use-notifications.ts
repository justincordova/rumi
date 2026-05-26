import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth";
import type { ListNotificationsResponse, Notification } from "@rumi/protocol";
import { useEffect, useRef, useState } from "react";

export function useNotifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const failCountRef = useRef(0);
  // Tracks whether the consuming component is still mounted. Without this
  // guard, a refetch in flight at unmount time will call setItems / setLoading
  // on an unmounted component (React warning + wasted render). Set inside the
  // mount effect below; the closure here captures it.
  const mountedRef = useRef(true);
  // Aborts the in-flight refetch when a new one starts (visibility change
  // triggers an immediate refetch while the polling timer fired one moments
  // before). Without this, a slow first response can clobber a fast second
  // response since both call setItems.
  const ctrlRef = useRef<AbortController | null>(null);

  async function refetch() {
    const token = useSession.getState().token;
    if (!token) return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    if (mountedRef.current) setLoading(true);
    try {
      const data = await apiFetch<ListNotificationsResponse>("/api/notifications", {
        signal: ctrl.signal,
      });
      if (!mountedRef.current || ctrl.signal.aborted) return;
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
      failCountRef.current = 0;
    } catch {
      if (mountedRef.current && !ctrl.signal.aborted) failCountRef.current++;
    } finally {
      if (mountedRef.current && !ctrl.signal.aborted) setLoading(false);
    }
  }

  function getInterval() {
    const fails = failCountRef.current;
    if (fails === 0) return 30_000;
    return Math.min(30_000 * 2 ** (fails - 1), 300_000);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch is stable for the lifetime of the hook; adding it would cause an infinite re-setup loop
  useEffect(() => {
    mountedRef.current = true;
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function scheduleNext() {
      if (stopped) return;
      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (stopped) return;
        const token = useSession.getState().token;
        if (!token) return;
        if (document.visibilityState === "visible") {
          void refetch().finally(() => {
            if (!stopped) scheduleNext();
          });
        }
      }, getInterval());
    }

    refetch();
    scheduleNext();

    function onVis() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        refetch();
        if (!timeoutId) scheduleNext();
      } else {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    }

    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      mountedRef.current = false;
      if (timeoutId) clearTimeout(timeoutId);
      ctrlRef.current?.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  async function markRead(ids: string[]) {
    const now = new Date().toISOString();
    setItems((cur) => {
      const prevUnread = cur.filter((n) => ids.includes(n.id) && !n.readAt).length;
      setUnreadCount((c) => Math.max(0, c - prevUnread));
      return cur.map((n) => (ids.includes(n.id) ? { ...n, readAt: now } : n));
    });
    try {
      await apiFetch("/api/notifications/read", { method: "POST", body: { ids } });
    } catch {
      refetch();
    }
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    try {
      await apiFetch("/api/notifications/read", { method: "POST", body: { all: true } });
    } catch {
      refetch();
    }
  }

  return { items, unreadCount, loading, refetch, markRead, markAllRead };
}

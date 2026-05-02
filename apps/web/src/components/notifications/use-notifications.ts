import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth";
import type { ListNotificationsResponse, Notification } from "@rumi/protocol";
import { useEffect, useRef, useState } from "react";

export function useNotifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const failCountRef = useRef(0);

  async function refetch() {
    const token = useSession.getState().token;
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch<ListNotificationsResponse>("/api/notifications");
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
      failCountRef.current = 0;
    } catch {
      failCountRef.current++;
    } finally {
      setLoading(false);
    }
  }

  function getInterval() {
    const fails = failCountRef.current;
    if (fails === 0) return 30_000;
    return Math.min(30_000 * 2 ** (fails - 1), 300_000);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch is stable for the lifetime of the hook; adding it would cause an infinite re-setup loop
  useEffect(() => {
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
      if (timeoutId) clearTimeout(timeoutId);
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

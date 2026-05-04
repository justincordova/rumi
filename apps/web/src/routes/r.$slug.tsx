import { ConnectionStatus } from "@/components/editor/connection-status";
import { GuestBanner } from "@/components/editor/guest-banner";
import { TabEditor } from "@/components/editor/tab-editor";
import { useRoomControlDoc } from "@/components/editor/use-room-control-doc";
import { TabBar } from "@/components/tabs/tab-bar";
import { useTabs } from "@/components/tabs/use-tabs";
import { TopBar } from "@/components/topbar";
import { ApiError, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { getGuestId } from "@/lib/guest";
import { useSeoMeta } from "@/lib/seo";
import { useRoomsStore } from "@/stores/rooms";
import type { GetRoomResponse as GetRoomResponseType } from "@rumi/protocol";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

function RoomError({ error }: { error: unknown }) {
  const nav = useNavigate();
  const session = useSession();

  useEffect(() => {
    const code = error instanceof ApiError ? error.code : "server_error";
    const msg =
      code === "not_found"
        ? "Room not found"
        : code === "forbidden"
          ? "You don't have access to this room"
          : code === "unauthorized"
            ? "Sign in required"
            : "Something went wrong";
    toast.error(msg);
    // Only bounce to sign-in when the user is anonymous AND the failure is
    // an auth one. A signed-in user hitting a forbidden/not_found room
    // belongs back on the dashboard, not the sign-in page.
    if (session.status !== "authenticated" && (code === "unauthorized" || code === "forbidden")) {
      nav({ to: "/sign-in", search: { next: window.location.pathname } });
    } else {
      nav({ to: "/dashboard" });
    }
  }, [error, nav, session.status]);

  return null;
}

export const Route = createFileRoute("/r/$slug")({
  validateSearch: (s) => ({ tab: typeof s.tab === "string" ? s.tab : undefined }),
  loader: async ({ params }) => {
    try {
      return await apiFetch<GetRoomResponseType>(`/api/rooms/${params.slug}`);
    } catch (err) {
      // Anonymous users get bounced to sign-in. Signed-in users who lack
      // access bubble the error up to errorComponent, which routes them
      // back to the dashboard.
      if (err instanceof ApiError && err.code === "unauthorized") {
        throw redirect({ to: "/sign-in", search: { next: `/r/${params.slug}` } });
      }
      throw err;
    }
  },
  errorComponent: RoomError,
  component: RoomPage,
});

function RoomPage() {
  const { room: loaderRoom, tabs: initialTabs, role } = Route.useLoaderData();
  const storeRoom = useRoomsStore((s) => s.rooms.find((r) => r.slug === loaderRoom.slug));
  const room = storeRoom ? { ...loaderRoom, ...storeRoom } : loaderRoom;
  const search = Route.useSearch();

  // Private rooms shouldn't appear in search results.
  useSeoMeta({
    title: `${room.name ?? room.slug}`,
    description: "Real-time collaborative room.",
    canonical: `/r/${room.slug}`,
    noindex: room.visibility === "private",
  });
  const navigate = Route.useNavigate();
  const isGuest = useSession((s) => s.status !== "authenticated");

  const token = useSession((s) => s.token) ?? getGuestId();

  const control = useRoomControlDoc({ roomId: room.id, token });
  const { tabs, activeTabId, setActiveTabId } = useTabs({
    initialTabs,
    controlDoc: control.ydoc,
    initialTabId: search.tab,
  });

  const onSelect = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      navigate({ search: { tab: tabId }, replace: true });
    },
    [setActiveTabId, navigate],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // Sync URL when activeTab resolves (e.g. after control doc loads)
  useEffect(() => {
    if (activeTab && activeTab.id !== search.tab) {
      navigate({ search: { tab: activeTab.id }, replace: true });
    }
  }, [activeTab, search.tab, navigate]);

  return (
    <div className="flex h-screen flex-col">
      <TopBar room={room} status={control.status} provider={control.provider} isGuest={isGuest} />
      {isGuest && <GuestBanner slug={room.slug} readOnly={control.readOnly} />}
      <TabBar
        tabs={tabs}
        activeTabId={activeTab?.id}
        roomSlug={room.slug}
        onSelect={onSelect}
        isGuest={isGuest}
        role={role}
      />
      <div className="flex-1 min-h-0">
        {activeTab && (
          <TabEditor tab={activeTab} roomSlug={room.slug} role={role} key={activeTab.id} />
        )}
      </div>
      <ConnectionStatus status={control.status} />
    </div>
  );
}

import { CreateRoomDialog } from "@/components/rooms/create-room-dialog";
import { EmptyState } from "@/components/rooms/empty-state";
import { RoomCard } from "@/components/rooms/room-card";
import { TopBar } from "@/components/topbar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth";
import { useRoomsStore } from "@/stores/rooms";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authed/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { rooms, status, fetch } = useRoomsStore();
  const { user } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const firstName = user?.displayName?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar onCreateRoom={() => setCreateOpen(true)} />
      <main className="flex-1 relative">
        <div className="absolute inset-0 bg-gradient-subtle pointer-events-none" />
        <div className="absolute inset-0 grid-dots opacity-20 pointer-events-none" />

        <div className="relative max-w-5xl w-full mx-auto px-6 py-10 space-y-8">
          <div className="animate-fade-in">
            <h1 className="text-3xl font-display font-semibold tracking-tight">
              {greeting}, {firstName}
            </h1>
            <p className="text-muted-foreground mt-1.5 text-[15px]">
              Pick up where you left off or start something new.
            </p>
          </div>

          {status === "loading" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[0, 1, 2].map((n) => (
                <Skeleton key={n} className="h-40 rounded-xl" />
              ))}
            </div>
          )}
          {status === "ready" && rooms.length === 0 && (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          )}
          {status === "ready" && rooms.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {rooms.map((r, i) => (
                <div
                  key={r.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <RoomCard room={r} />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

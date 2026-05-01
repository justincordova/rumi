import { CreateRoomDialog } from "@/components/rooms/create-room-dialog";
import { EmptyState } from "@/components/rooms/empty-state";
import { RoomCard } from "@/components/rooms/room-card";
import { TopBar } from "@/components/topbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth";
import { type RoomSort, useRoomsStore } from "@/stores/rooms";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownAZ, Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authed/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { rooms, status, fetch, sort, setSort } = useRoomsStore();
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
      <TopBar />
      <main className="flex-1 relative">
        <div className="absolute inset-0 bg-gradient-subtle pointer-events-none" />
        <div className="absolute inset-0 grid-dots opacity-20 pointer-events-none" />

        <div className="relative max-w-5xl w-full mx-auto px-6 py-10 space-y-8">
          <div className="animate-fade-in flex items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-display font-semibold tracking-tight">
                {greeting}, {firstName}
              </h1>
              <p className="text-muted-foreground mt-1.5 text-[15px]">
                Pick up where you left off or start something new.
              </p>
            </div>
            {rooms.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ArrowDownAZ className="h-3.5 w-3.5" />
                      {sort === "updated"
                        ? "Last updated"
                        : sort === "created"
                          ? "Date created"
                          : "Name"}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={8} className="w-44">
                    <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Sort by
                    </DropdownMenuLabel>
                    {(
                      [
                        { value: "updated", label: "Last updated" },
                        { value: "created", label: "Date created" },
                        { value: "name", label: "Name" },
                      ] as { value: RoomSort; label: string }[]
                    ).map((opt) => (
                      <DropdownMenuItem
                        key={opt.value}
                        onSelect={() => setSort(opt.value)}
                        className="flex items-center gap-2"
                      >
                        {sort === opt.value && <Check className="h-3.5 w-3.5" />}
                        <span className={sort === opt.value ? "" : "ml-[20px]"}>{opt.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New room
                </button>
              </div>
            )}
            {rooms.length === 0 && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                New room
              </button>
            )}
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

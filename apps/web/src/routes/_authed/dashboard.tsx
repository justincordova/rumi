import { CreateRoomDialog } from "@/components/rooms/create-room-dialog";
import { EmptyState } from "@/components/rooms/empty-state";
import { RoomCard } from "@/components/rooms/room-card";
import { RoomRow } from "@/components/rooms/room-row";
import { RouteError } from "@/components/route-error";
import { TopBar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth";
import { useSeoMeta } from "@/lib/seo";
import { type RoomSort, type ViewMode, useRoomsStore } from "@/stores/rooms";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownAZ, Check, LayoutGrid, List, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
  errorComponent: DashboardRouteError,
});

function DashboardRouteError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <RouteError error={error} reset={reset} boundary="dashboard" homePath="/" homeLabel="Home" />
  );
}

function DashboardPage() {
  useSeoMeta({
    title: "Dashboard",
    description: "Your collaborative rooms.",
    noindex: true,
  });
  const {
    rooms,
    status,
    fetch,
    sort,
    setSort,
    search,
    setSearch,
    viewMode,
    setViewMode,
    filtered,
  } = useRoomsStore();
  const { user } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const firstName = user?.displayName?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const displayed = filtered();

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
                {greeting},{" "}
                <span className="animate-gradient bg-gradient-to-r from-[#8839ef] via-[#ea76cb] to-[#8839ef] bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(136,57,239,0.35)] dark:from-[#cba6f7] dark:via-[#f5c2e7] dark:to-[#cba6f7] dark:drop-shadow-[0_0_18px_rgba(203,166,247,0.35)]">
                  {firstName}
                </span>
              </h1>
              <p className="text-muted-foreground mt-1.5 text-[15px]">
                Pick up where you left off or start something new.
              </p>
            </div>
            {rooms.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[12px] text-muted-foreground tabular-nums mr-1">
                  {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
                </span>
                <ViewToggle mode={viewMode} onChange={setViewMode} />
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

          {rooms.length > 0 && status !== "loading" && (
            <div className="animate-fade-in flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 h-9 rounded-lg border border-border bg-surface/80 px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rooms…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="text-xs">&#x2715;</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {status === "loading" && (
            <div
              className={`gap-5 ${viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "flex flex-col"}`}
            >
              {[0, 1, 2].map((n) => (
                <Skeleton
                  key={n}
                  className={viewMode === "grid" ? "h-40 rounded-xl" : "h-14 rounded-lg"}
                />
              ))}
            </div>
          )}
          {status === "error" && (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
              <p className="text-muted-foreground text-[15px]">Couldn't load your rooms.</p>
              <Button variant="outline" className="mt-4" onClick={() => void fetch()}>
                Retry
              </Button>
            </div>
          )}
          {status === "ready" && rooms.length > 0 && displayed.length === 0 && search && (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
              <p className="text-muted-foreground text-[15px]">
                No rooms match "<span className="text-foreground font-medium">{search}</span>"
              </p>
            </div>
          )}
          {status === "ready" && rooms.length === 0 && (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          )}
          {status === "ready" && displayed.length > 0 && viewMode === "grid" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayed.map((r, i) => (
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
          {status === "ready" && displayed.length > 0 && viewMode === "list" && (
            <div className="flex flex-col gap-2">
              {displayed.map((r, i) => (
                <div
                  key={r.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <RoomRow room={r} />
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="absolute bottom-4 left-0 right-0 text-center text-[12px] text-muted-foreground/50">
          &copy; {new Date().getFullYear()} Rumi
        </p>
      </main>

      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-label="Grid view"
        aria-pressed={mode === "grid"}
        className={`grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${mode === "grid" ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-label="List view"
        aria-pressed={mode === "list"}
        className={`grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${mode === "list" ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
      >
        <List className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

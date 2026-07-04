import logoT from "@/assets/logos/logo-t.png";
import { PresenceAvatars } from "@/components/editor/presence-avatars";
import { BellPopover } from "@/components/notifications/bell-popover";
import { MembersDialog } from "@/components/rooms/members-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signInWithProvider } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Room } from "@rumi/protocol";
import { Link } from "@tanstack/react-router";
import { Check, LogIn, MoreVertical, Settings2, Users } from "lucide-react";
import { useState } from "react";
import { AppearanceItems } from "./appearance-items";
import { DashboardDropdown } from "./dashboard-dropdown";
import { PlanBadge } from "./plan-badge";
import { RenameRoomItem, VisibilitySelector } from "./room-menu";
import { ShareButton } from "./share-button";

interface TopBarProps {
  room?: Room;
  status?: "connecting" | "connected" | "disconnected";
  provider?: HocuspocusProvider | null;
  isGuest?: boolean;
  role?: "owner" | "admin" | "member" | null;
}

export function TopBar({ room, status, provider, isGuest, role }: TopBarProps) {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const [membersOpen, setMembersOpen] = useState(false);
  // Rename / visibility / guest access are owner-only on the server
  // (updateRoom rejects everyone else) — don't render dead controls that walk
  // members through a prompt only to fail with a toast.
  const isOwner = role === "owner";

  return (
    <header className="h-14 border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-10">
      <div className="flex h-full items-center px-4 lg:px-8 gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md">
            <img src={logoT} alt="Rumi" className="h-7 w-7" />
          </div>
          <span className="font-display text-[15px] font-semibold tracking-tight">Rumi</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {room && status === "connected" && (
            <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-pulse-soft rounded-full bg-success" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              <span className="text-[11px] font-medium text-success">Live</span>
            </div>
          )}

          {room && provider && status === "connected" && (
            <PresenceAvatars provider={provider} max={5} />
          )}

          {room && !isGuest && (
            <>
              {/* md+ : full-width controls */}
              <div className="hidden md:flex items-center gap-2">
                <ShareButton room={room} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setMembersOpen(true)}
                  aria-label="Members"
                >
                  <Users className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Room settings"
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={16} className="w-52">
                    {isOwner && (
                      <>
                        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Room
                        </DropdownMenuLabel>
                        <RenameRoomItem room={room} />
                        <VisibilitySelector room={room} />
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Appearance
                    </DropdownMenuLabel>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {(["light", "dark", "system"] as const).map((t) => (
                          <DropdownMenuItem
                            key={t}
                            onSelect={() => setTheme(t)}
                            className="flex items-center gap-2"
                          >
                            {theme === t && <Check className="h-3.5 w-3.5" />}
                            <span className={theme === t ? "" : "ml-[20px]"}>
                              {t.charAt(0).toUpperCase() + t.slice(1)}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <AppearanceItems />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* < md : single overflow menu collapses Share/Members/Settings */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 md:hidden"
                    aria-label="Room actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={16} className="w-52">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Room
                  </DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => setMembersOpen(true)}>Members</DropdownMenuItem>
                  {isOwner && (
                    <>
                      <RenameRoomItem room={room} />
                      <VisibilitySelector room={room} />
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Appearance
                  </DropdownMenuLabel>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {(["light", "dark", "system"] as const).map((t) => (
                        <DropdownMenuItem
                          key={t}
                          onSelect={() => setTheme(t)}
                          className="flex items-center gap-2"
                        >
                          {theme === t && <Check className="h-3.5 w-3.5" />}
                          <span className={theme === t ? "" : "ml-[20px]"}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <AppearanceItems />
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {!isGuest && (
            <>
              <BellPopover />
              <PlanBadge />
            </>
          )}

          {isGuest && room && (
            <Button
              onClick={() => signInWithProvider("github", window.location.pathname)}
              className="bg-foreground text-background hover:bg-foreground/90 shadow-sm hover:shadow-md transition-all h-8 px-3"
            >
              <LogIn className="h-3.5 w-3.5 mr-1.5" />
              Sign in
            </Button>
          )}

          {!isGuest && <DashboardDropdown />}
        </div>
      </div>

      {room && <MembersDialog open={membersOpen} onOpenChange={setMembersOpen} room={room} />}
    </header>
  );
}

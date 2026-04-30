import logoT from "@/assets/logos/logo-t.png";
import { PresenceAvatars } from "@/components/editor/presence-avatars";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { apiFetch } from "@/lib/api";
import { signInWithProvider, signOut, useSession } from "@/lib/auth";
import { EDITOR_FONTS, type EditorFontKey } from "@/lib/fonts";
import { usePrefs } from "@/lib/prefs";
import { type RoomSort, useRoomsStore } from "@/stores/rooms";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Room } from "@rumi/protocol";
import type { UpdateRoomResponse } from "@rumi/protocol";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownAZ,
  Bell,
  Check,
  CreditCard,
  Link2,
  LogIn,
  Minus,
  Plus,
  Settings,
  Settings2,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface TopBarProps {
  room?: Room;
  status?: "connecting" | "connected" | "disconnected";
  provider?: HocuspocusProvider | null;
  isGuest?: boolean;
  onCreateRoom?: () => void;
  activeTabName?: string;
}

export function TopBar({
  room,
  status,
  provider,
  isGuest,
  onCreateRoom,
  activeTabName,
}: TopBarProps) {
  const { user } = useSession();
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const rooms = useRoomsStore((s) => s.rooms);
  const sort = useRoomsStore((s) => s.sort);
  const setSort = useRoomsStore((s) => s.setSort);

  return (
    <header className="h-14 border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-10 flex items-center pl-4 pr-3 gap-3">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-md">
          <img src={logoT} alt="Rumi" className="h-7 w-7" />
        </div>
        <span className="font-display text-[15px] font-semibold tracking-tight">Rumi</span>
      </Link>

      {/* Dashboard label */}
      {!room && (
        <>
          <div className="h-4 w-px bg-border shrink-0" />
          <span className="text-sm font-medium text-muted-foreground">Your rooms</span>
        </>
      )}

      {/* Room title + visibility badge */}
      {room && (
        <>
          <div className="h-4 w-px bg-border shrink-0" />
          <RoomTitle room={room} />
          <VisibilityBadge room={room} />
          {activeTabName && (
            <>
              <div className="h-4 w-px bg-border shrink-0" />
              <span className="text-[13px] text-muted-foreground truncate max-w-[160px]">
                {activeTabName}
              </span>
            </>
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        {/* Dashboard controls */}
        {onCreateRoom && (
          <>
            {/* Room count */}
            {rooms.length > 0 && (
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
              </span>
            )}

            {/* Sort control */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ArrowDownAZ className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={16} className="w-44">
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

            {/* Notification bell */}
            <Button variant="ghost" size="icon" className="h-8 w-8 relative" disabled>
              <Bell className="h-4 w-4" />
            </Button>

            {/* New room button */}
            <button
              type="button"
              onClick={onCreateRoom}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </>
        )}

        {/* Live pill — directly left of presence avatars */}
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

        {room && <ShareButton room={room} />}

        {isGuest && room ? (
          <Button
            onClick={() => signInWithProvider("github", window.location.pathname)}
            className="bg-foreground text-background hover:bg-foreground/90 shadow-sm hover:shadow-md transition-all h-8 px-3"
          >
            <LogIn className="h-3.5 w-3.5 mr-1.5" />
            Sign in
          </Button>
        ) : room ? (
          // Room settings dropdown
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Settings2 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={16} className="w-52">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Room
              </DropdownMenuLabel>
              <RenameRoomItem room={room} />
              <CopyLinkItem />
              <VisibilitySelector room={room} />
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
              <EditorFontItem />
              <FontSizeItem />
              <WordWrapItem />
              <CompactModeItem />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // Dashboard user dropdown
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.displayName} />
                  <AvatarFallback>{user?.displayName?.[0] ?? "?"}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={16} className="w-48">
              <DropdownMenuLabel className="font-medium text-sm">
                {user?.displayName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <Zap className="h-3.5 w-3.5 mr-2" />
                Upgrade
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <CreditCard className="h-3.5 w-3.5 mr-2" />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Settings className="h-3.5 w-3.5 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

// ── Room title inline rename ──────────────────────────────────────────────────

function RoomTitle({ room }: { room: Room }) {
  const [editing, setEditing] = useState(false);
  const title = room.name?.trim() || room.slug;
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateRoom = useRoomsStore((s) => s.updateRoom);

  useEffect(() => {
    setDraft(title);
  }, [title]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    if (next !== (room.name ?? "")) {
      try {
        const updated = await apiFetch<UpdateRoomResponse>(`/api/rooms/${room.slug}`, {
          method: "PATCH",
          body: { name: next || null },
        });
        updateRoom(updated.room);
      } catch {
        toast.error("Couldn't rename room");
      }
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
        className="border border-border bg-surface rounded-md px-2.5 py-1 text-sm font-medium ring-2 ring-ring/30 outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex items-center gap-2 text-sm font-medium hover:bg-muted/60 rounded-md px-2 py-1 transition-colors"
    >
      {title}
      <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
        rename
      </span>
    </button>
  );
}

// ── Settings dropdown items ───────────────────────────────────────────────────

function RenameRoomItem({ room }: { room: Room }) {
  const updateRoom = useRoomsStore((s) => s.updateRoom);

  async function handleRename() {
    const next = window.prompt("Room name", room.name?.trim() || room.slug);
    if (next === null) return; // cancelled
    try {
      const updated = await apiFetch<UpdateRoomResponse>(`/api/rooms/${room.slug}`, {
        method: "PATCH",
        body: { name: next.trim() || null },
      });
      updateRoom(updated.room);
      toast.success("Room renamed");
    } catch {
      toast.error("Couldn't rename room");
    }
  }

  return <DropdownMenuItem onSelect={handleRename}>Rename room…</DropdownMenuItem>;
}

function CopyLinkItem() {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy link");
    }
  }

  return <DropdownMenuItem onSelect={handleCopy}>Copy invite link</DropdownMenuItem>;
}

// ── Visibility badge (inline in room topbar) ─────────────────────────────────

function VisibilityBadge({ room }: { room: Room }) {
  if (room.visibility === "private") {
    return (
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        Private
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      Open
    </span>
  );
}

// ── Visibility selector ──────────────────────────────────────────────────────

const VISIBILITY_OPTIONS: { value: Room["visibility"]; label: string; desc: string }[] = [
  { value: "open", label: "Open", desc: "Anyone with the link can join and edit." },
  { value: "private", label: "Private", desc: "Invite only." },
];

const GUEST_ACCESS_OPTIONS: { value: Room["guestAccess"]; label: string }[] = [
  { value: "none", label: "Sign-in required" },
  { value: "view", label: "Guests can view" },
  { value: "edit", label: "Guests can edit" },
];

function VisibilitySelector({ room }: { room: Room }) {
  const updateRoom = useRoomsStore((s) => s.updateRoom);

  async function setVisibility(value: Room["visibility"]) {
    try {
      const updated = await apiFetch<UpdateRoomResponse>(`/api/rooms/${room.slug}`, {
        method: "PATCH",
        body: { visibility: value },
      });
      updateRoom(updated.room);
    } catch {
      toast.error("Couldn't change visibility");
    }
  }

  async function setGuestAccess(value: Room["guestAccess"]) {
    try {
      const updated = await apiFetch<UpdateRoomResponse>(`/api/rooms/${room.slug}`, {
        method: "PATCH",
        body: { guestAccess: value },
      });
      updateRoom(updated.room);
    } catch {
      toast.error("Couldn't change guest access");
    }
  }

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Visibility</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {VISIBILITY_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => setVisibility(opt.value)}
              className="flex items-center gap-2"
            >
              {room.visibility === opt.value && <Check className="h-3.5 w-3.5" />}
              <span className={room.visibility === opt.value ? "" : "ml-[20px]"}>{opt.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Guest access</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {GUEST_ACCESS_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => setGuestAccess(opt.value)}
              className="flex items-center gap-2"
            >
              {room.guestAccess === opt.value && <Check className="h-3.5 w-3.5" />}
              <span className={room.guestAccess === opt.value ? "" : "ml-[20px]"}>{opt.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

// ── Share button ──────────────────────────────────────────────────────────────

function shareDesc(room: Room): string {
  if (room.visibility === "private") {
    if (room.guestAccess === "view") return "Invitees only. Guests can view.";
    if (room.guestAccess === "edit") return "Invitees only. Guests can edit.";
    return "Invitees only.";
  }
  // open
  if (room.guestAccess === "view") return "Anyone can view. Sign in to edit.";
  if (room.guestAccess === "edit") return "Anyone with this link can edit.";
  return "Anyone signed in can join and edit.";
}

function ShareButton({ room }: { room: Room }) {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? Check : Link2;
  const desc = shareDesc(room);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied", { description: desc });
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <Button
      onClick={handleCopy}
      className="bg-foreground text-background hover:bg-foreground/90 shadow-sm hover:shadow-md transition-all h-8 px-3"
    >
      <Icon className="h-3.5 w-3.5 mr-1.5" />
      Share
    </Button>
  );
}

// ── Editor settings items ─────────────────────────────────────────────────────

function EditorFontItem() {
  const editorFont = usePrefs((s) => s.editorFont);
  const setEditorFont = usePrefs((s) => s.setEditorFont);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Font</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {(
          Object.entries(EDITOR_FONTS) as [EditorFontKey, (typeof EDITOR_FONTS)[EditorFontKey]][]
        ).map(([key, font]) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => setEditorFont(key)}
            className="flex items-center gap-2"
          >
            {editorFont === key && <Check className="h-3.5 w-3.5" />}
            <span className={editorFont === key ? "" : "ml-[20px]"}>{font.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function FontSizeItem() {
  const fontSize = usePrefs((s) => s.fontSize);
  const setFontSize = usePrefs((s) => s.setFontSize);
  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-sm">
      <span>Font size</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setFontSize(Math.max(10, fontSize - 1))}
          className="grid h-6 w-6 place-items-center rounded hover:bg-muted"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-6 text-center text-xs tabular-nums">{fontSize}</span>
        <button
          type="button"
          onClick={() => setFontSize(Math.min(24, fontSize + 1))}
          className="grid h-6 w-6 place-items-center rounded hover:bg-muted"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function WordWrapItem() {
  const wordWrap = usePrefs((s) => s.wordWrap);
  const setWordWrap = usePrefs((s) => s.setWordWrap);
  return (
    <DropdownMenuItem className="flex items-center gap-2" onSelect={() => setWordWrap(!wordWrap)}>
      {wordWrap && <Check className="h-3.5 w-3.5" />}
      <span className={wordWrap ? "" : "ml-[20px]"}>Word wrap</span>
    </DropdownMenuItem>
  );
}

function CompactModeItem() {
  const compactMode = usePrefs((s) => s.compactMode);
  const setCompactMode = usePrefs((s) => s.setCompactMode);
  return (
    <DropdownMenuItem
      className="flex items-center gap-2"
      onSelect={() => setCompactMode(!compactMode)}
    >
      {compactMode && <Check className="h-3.5 w-3.5" />}
      <span className={compactMode ? "" : "ml-[20px]"}>Compact mode</span>
    </DropdownMenuItem>
  );
}

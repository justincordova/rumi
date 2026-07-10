import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { useRoomsStore } from "@/stores/rooms";
import type { Room } from "@rumi/protocol";
import type { UpdateRoomResponse } from "@rumi/protocol";
import { useNavigate } from "@tanstack/react-router";
import { Check, Globe, Link2, Lock, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DeleteRoomDialog } from "./delete-room-dialog";

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RoomRow({
  room,
}: { room: Room & { pendingAccess?: boolean; pendingWhitelistId?: string } }) {
  const { user } = useSession();
  const isOwner = user?.id === room.ownerId;
  const updateRoom = useRoomsStore((s) => s.updateRoom);
  const removeRoom = useRoomsStore((s) => s.removeRoom);
  const [declining, setDeclining] = useState(false);
  const [editing, setEditing] = useState(false);
  const title = room.name?.trim() || room.slug;
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setDraft(title);
  }, [title]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function declineInvite(e: React.MouseEvent) {
    e.stopPropagation();
    if (!room.pendingWhitelistId || declining) return;
    setDeclining(true);
    try {
      await apiFetch(`/api/rooms/${room.slug}/whitelist/${room.pendingWhitelistId}`, {
        method: "DELETE",
      });
      removeRoom(room.slug);
      toast.success("Invitation declined");
    } catch {
      toast.error("Couldn't decline invitation");
      setDeclining(false);
    }
  }

  // Same Enter-then-blur double-submit guard as room-title.tsx, with the
  // same catch+toast+revert+close pattern as room-card.tsx.
  const committingRef = useRef(false);
  async function commit() {
    if (committingRef.current) return;
    committingRef.current = true;
    const next = draft.trim();
    try {
      // Compare against the displayed title (name || slug), not `room.name`,
      // so a no-change blur on a null-name room doesn't PATCH name to the slug.
      if (next !== title && next !== (room.name ?? "")) {
        const res = await apiFetch<UpdateRoomResponse>(`/api/rooms/${room.slug}`, {
          method: "PATCH",
          body: { name: next || null },
        });
        updateRoom(res.room);
      }
      setEditing(false);
    } catch (err: unknown) {
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't rename room");
      setDraft(title);
      setEditing(false);
    } finally {
      committingRef.current = false;
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: row is not a button element
    // biome-ignore lint/a11y/useKeyWithClickEvents: row is not an interactive control
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open room ${title}`}
      className="group flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 transition-all duration-150 hover:border-border-strong hover:shadow-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={() => {
        if (!editing && !menuOpen && !deleteOpen) {
          navigate({ to: "/r/$slug", params: { slug: room.slug }, search: { tab: undefined } });
        }
      }}
      onKeyDown={(e) => {
        if (!editing && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          navigate({ to: "/r/$slug", params: { slug: room.slug }, search: { tab: undefined } });
        }
      }}
    >
      <div className="flex-1 min-w-0 flex items-center gap-3">
        {editing ? (
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
            onClick={(e) => e.stopPropagation()}
            aria-label="Room name"
            className="w-64 border border-border bg-surface rounded-md px-2 py-1 text-sm font-medium ring-2 ring-ring/30 outline-none"
          />
        ) : (
          <span
            className="text-sm font-medium truncate"
            onDoubleClick={
              isOwner
                ? (e) => {
                    e.stopPropagation();
                    setEditing(true);
                  }
                : undefined
            }
          >
            {title}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground shrink-0">
        {room.visibility === "private" ? (
          <Lock className="h-3 w-3" />
        ) : (
          <Globe className="h-3 w-3" />
        )}
        {isOwner && (
          <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
            Owner
          </span>
        )}
        {room.pendingAccess ? (
          <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-medium">
            Invited
          </span>
        ) : null}
        {!room.pendingAccess && <span>{relativeDate(room.updatedAt)}</span>}
      </div>

      {room.pendingAccess && (
        <div
          className="flex items-center gap-1.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            className="h-7 px-2.5 text-[12px]"
            onClick={(e) => {
              e.stopPropagation();
              navigate({
                to: "/r/$slug",
                params: { slug: room.slug },
                search: { tab: undefined },
              });
            }}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-[12px]"
            disabled={declining}
            onClick={declineInvite}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Decline
          </Button>
        </div>
      )}

      {!room.pendingAccess && isOwner && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuItem
              onClick={(e) => e.stopPropagation()}
              onSelect={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => e.stopPropagation()}
              onSelect={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/r/${room.slug}`);
                  toast.success("Link copied");
                } catch {
                  toast.error("Could not copy link");
                }
              }}
            >
              <Link2 className="h-4 w-4" />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => e.stopPropagation()}
              onSelect={() => setDeleteOpen(true)}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DeleteRoomDialog open={deleteOpen} onOpenChange={setDeleteOpen} slug={room.slug} />
    </div>
  );
}

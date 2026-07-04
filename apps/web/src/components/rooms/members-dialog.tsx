import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { useRoomsStore } from "@/stores/rooms";
import type {
  ListBlacklistResponse,
  ListMembersResponse,
  ListWhitelistResponse,
  Room,
  RoomBlacklistEntry,
  RoomMember,
  RoomWhitelistEntry,
} from "@rumi/protocol";
import type { UpdateRoomResponse } from "@rumi/protocol";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Ban, Crown, Mail, MoreVertical, Plus, Shield, Trash2, UserMinus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const GUEST_ACCESS_OPTIONS: { value: Room["guestAccess"]; label: string }[] = [
  { value: "none", label: "Sign-in required" },
  { value: "view", label: "Guests can view" },
  { value: "edit", label: "Guests can edit" },
];

export function MembersDialog({
  open,
  onOpenChange,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: Room;
}) {
  const { user } = useSession();
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [whitelist, setWhitelist] = useState<RoomWhitelistEntry[]>([]);
  const [blacklist, setBlacklist] = useState<RoomBlacklistEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const navigate = useNavigate();
  const router = useRouter();
  const isOwner = user?.id === room.ownerId;
  const isAdmin = isOwner || members.find((m) => m.userId === user?.id)?.role === "admin";
  const isPrivate = room.visibility === "private";
  const updateRoom = useRoomsStore((s) => s.updateRoom);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    action: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", action: "", onConfirm: () => {} });

  function showConfirm(opts: {
    title: string;
    description: string;
    action: string;
    onConfirm: () => void;
  }) {
    setConfirmState({ open: true, ...opts });
  }

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [membersRes, whitelistRes, blacklistRes] = await Promise.all([
        apiFetch<ListMembersResponse>(`/api/rooms/${room.slug}/members`),
        isAdmin ? apiFetch<ListWhitelistResponse>(`/api/rooms/${room.slug}/whitelist`) : null,
        isAdmin ? apiFetch<ListBlacklistResponse>(`/api/rooms/${room.slug}/blacklist`) : null,
      ]);
      setMembers(membersRes.members);
      if (whitelistRes) setWhitelist(whitelistRes.entries);
      if (blacklistRes) setBlacklist(blacklistRes.entries);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [room.slug, isAdmin]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function changeRole(member: RoomMember, role: "admin" | "member") {
    try {
      await apiFetch(`/api/rooms/${room.slug}/members/${member.userId}`, {
        method: "PATCH",
        body: { role },
      });
      toast.success(`Updated to ${role}`);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update role");
    }
  }

  async function kick(member: RoomMember) {
    showConfirm({
      title: "Remove member?",
      description: `${member.displayName ?? member.email ?? "This member"} will lose access immediately and be added to the blacklist.`,
      action: "Remove",
      onConfirm: async () => {
        try {
          await apiFetch(`/api/rooms/${room.slug}/members/${member.userId}`, {
            method: "DELETE",
          });
          toast.success("Member removed");
          void load();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Couldn't remove member");
        }
      },
    });
  }

  async function transfer(member: RoomMember) {
    showConfirm({
      title: "Transfer ownership?",
      description: `You'll become an admin. ${member.displayName ?? member.email ?? "This user"} will become the owner.`,
      action: "Transfer",
      onConfirm: async () => {
        try {
          await apiFetch(`/api/rooms/${room.slug}/transfer-ownership`, {
            method: "POST",
            body: { newOwnerId: member.userId },
          });
          toast.success("Ownership transferred");
          onOpenChange(false);
          await router.invalidate();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Couldn't transfer ownership");
        }
      },
    });
  }

  async function leave() {
    showConfirm({
      title: "Leave this room?",
      description: "You'll lose access to this room.",
      action: "Leave",
      onConfirm: async () => {
        try {
          await apiFetch(`/api/rooms/${room.slug}/members/me`, { method: "DELETE" });
          toast.success("You left the room");
          navigate({ to: "/dashboard" });
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Couldn't leave room");
        }
      },
    });
  }

  async function addToWhitelist(email: string) {
    try {
      await apiFetch(`/api/rooms/${room.slug}/whitelist`, {
        method: "POST",
        body: { email },
      });
      toast.success(`Added ${email} to whitelist`);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add to whitelist");
    }
  }

  async function removeWhitelistEntry(id: string) {
    try {
      await apiFetch(`/api/rooms/${room.slug}/whitelist/${id}`, { method: "DELETE" });
      toast.success("Removed from whitelist");
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't remove");
    }
  }

  async function addToBlacklist(email: string) {
    try {
      await apiFetch(`/api/rooms/${room.slug}/blacklist`, {
        method: "POST",
        body: { email },
      });
      toast.success(`Added ${email} to blacklist`);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add to blacklist");
    }
  }

  async function removeBlacklistEntry(id: string) {
    try {
      await apiFetch(`/api/rooms/${room.slug}/blacklist/${id}`, { method: "DELETE" });
      toast.success("Removed from blacklist");
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't remove");
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

  const memberEmails = new Set(members.map((m) => m.email?.toLowerCase()).filter(Boolean));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Members</DialogTitle>
          <DialogDescription>
            {isPrivate
              ? "Manage members and who can access this room."
              : "Manage members and guest access for this room."}
          </DialogDescription>
        </DialogHeader>

        {status === "loading" && (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        )}
        {status === "error" && (
          <p className="text-sm text-destructive py-6 text-center">Failed to load members</p>
        )}
        {status === "ready" && (
          <Tabs defaultValue="members">
            <TabsList className="w-full">
              <TabsTrigger value="members" className="flex-1">
                Members ({members.length})
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="blacklist" className="flex-1">
                  Blacklist ({blacklist.length})
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="members">
              {isPrivate && isAdmin && (
                <AddEmailInput placeholder="Add by email…" onSubmit={addToWhitelist} />
              )}

              <ul className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
                {members.map((m) => (
                  <MemberRow
                    key={m.userId}
                    member={m}
                    isViewerOwner={isOwner}
                    isViewerAdmin={isAdmin}
                    isSelf={m.userId === user?.id}
                    onChangeRole={(role) => changeRole(m, role)}
                    onKick={() => kick(m)}
                    onTransfer={() => transfer(m)}
                    onLeave={leave}
                  />
                ))}
                {isPrivate &&
                  whitelist
                    .filter((w) => !memberEmails.has(w.email.toLowerCase()))
                    .map((w) => (
                      <li
                        key={w.id}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50"
                      >
                        <div className="h-8 w-8 rounded-full bg-warning/15 text-warning grid place-items-center">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{w.email}</p>
                        </div>
                        <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-medium">
                          Invited
                        </span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => removeWhitelistEntry(w.id)}
                            aria-label={`Remove ${w.email} from whitelist`}
                            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </li>
                    ))}
              </ul>

              {!isPrivate && isOwner && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                    Guest access
                  </p>
                  <div className="flex gap-1">
                    {GUEST_ACCESS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGuestAccess(opt.value)}
                        className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                          room.guestAccess === opt.value
                            ? "bg-foreground text-background"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {isAdmin && (
              <TabsContent value="blacklist">
                <AddEmailInput placeholder="Block by email…" onSubmit={addToBlacklist} />

                {blacklist.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No blocked emails
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
                    {blacklist.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50"
                      >
                        <div className="h-8 w-8 rounded-full bg-destructive/10 text-destructive grid place-items-center">
                          <Ban className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{b.email}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeBlacklistEntry(b.id)}
                          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Remove from blacklist"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
      <AlertDialog
        open={confirmState.open}
        onOpenChange={(open) => {
          if (!open) setConfirmState((s) => ({ ...s, open: false }));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.stopPropagation();
                confirmState.onConfirm();
                setConfirmState((s) => ({ ...s, open: false }));
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmState.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// Permissive client-side email shape check — defense against an obvious typo
// before paying for a round-trip. The server is the source of truth.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AddEmailInput({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (email: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      toast.error("Please enter a valid email address");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(trimmed.toLowerCase());
      setValue("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3">
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={submitting}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label="Add email"
          disabled={submitting}
          className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors shrink-0 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}

function MemberRow({
  member,
  isViewerOwner,
  isViewerAdmin,
  isSelf,
  onChangeRole,
  onKick,
  onTransfer,
  onLeave,
}: {
  member: RoomMember;
  isViewerOwner: boolean;
  isViewerAdmin: boolean;
  isSelf: boolean;
  onChangeRole: (role: "admin" | "member") => void;
  onKick: () => void;
  onTransfer: () => void;
  onLeave: () => void;
}) {
  const name = member.displayName ?? member.email ?? "Member";
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roleBadge =
    member.role === "owner" ? (
      <span className="flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
        <Crown className="h-3 w-3" /> Owner
      </span>
    ) : member.role === "admin" ? (
      <span className="flex items-center gap-1 rounded-full bg-muted text-foreground px-2 py-0.5 text-[11px] font-medium">
        <Shield className="h-3 w-3" /> Admin
      </span>
    ) : (
      <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[11px] font-medium">
        Member
      </span>
    );

  // Server rule (kickMember): owners can kick anyone but themselves; admins
  // can kick members only — never peer admins. Don't render a menu whose only
  // action is guaranteed to fail with a 403 toast.
  const canKick =
    isViewerAdmin &&
    !isSelf &&
    member.role !== "owner" &&
    (isViewerOwner || member.role === "member");
  const showMenu = canKick || (isViewerOwner && !isSelf && member.role !== "owner");

  return (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50">
      {member.avatarUrl ? (
        <img
          src={member.avatarUrl}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="h-8 w-8 rounded-full bg-muted text-muted-foreground grid place-items-center text-[11px] font-medium">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {name}
          {isSelf && <span className="text-muted-foreground"> (you)</span>}
        </p>
        {member.email && member.displayName && (
          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
        )}
      </div>
      {roleBadge}

      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Member options for ${name}`}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            {isViewerOwner && member.role === "member" && (
              <DropdownMenuItem onSelect={() => onChangeRole("admin")}>
                <Shield className="h-4 w-4" />
                Promote to admin
              </DropdownMenuItem>
            )}
            {isViewerOwner && member.role === "admin" && (
              <DropdownMenuItem onSelect={() => onChangeRole("member")}>
                <Shield className="h-4 w-4" />
                Demote to member
              </DropdownMenuItem>
            )}
            {isViewerOwner && member.role !== "owner" && (
              <DropdownMenuItem onSelect={() => onTransfer()}>
                <Crown className="h-4 w-4" />
                Transfer ownership
              </DropdownMenuItem>
            )}
            {isViewerOwner && canKick && <DropdownMenuSeparator />}
            {canKick && (
              <DropdownMenuItem
                onSelect={() => onKick()}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <UserMinus className="h-4 w-4" />
                Remove from room
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {isSelf && member.role !== "owner" && (
        <button
          type="button"
          onClick={onLeave}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          Leave
        </button>
      )}
    </li>
  );
}

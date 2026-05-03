import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { useRoomsStore } from "@/stores/rooms";
import type { Room } from "@rumi/protocol";
import type { UpdateRoomResponse } from "@rumi/protocol";
import { Check } from "lucide-react";
import { toast } from "sonner";

const VISIBILITY_OPTIONS: { value: Room["visibility"]; label: string; desc: string }[] = [
  { value: "open", label: "Open", desc: "Anyone with the link can join and edit." },
  { value: "private", label: "Private", desc: "Invite only." },
];

const GUEST_ACCESS_OPTIONS: { value: Room["guestAccess"]; label: string }[] = [
  { value: "none", label: "Sign-in required" },
  { value: "view", label: "Guests can view" },
  { value: "edit", label: "Guests can edit" },
];

export function RenameRoomItem({ room }: { room: Room }) {
  const updateRoom = useRoomsStore((s) => s.updateRoom);

  async function handleRename() {
    const next = window.prompt("Room name", room.name?.trim() || room.slug);
    if (next === null) return;
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

export function VisibilitySelector({ room }: { room: Room }) {
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
      {room.visibility === "open" && (
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
                <span className={room.guestAccess === opt.value ? "" : "ml-[20px]"}>
                  {opt.label}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
    </>
  );
}

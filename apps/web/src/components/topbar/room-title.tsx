import { apiFetch } from "@/lib/api";
import { useRoomsStore } from "@/stores/rooms";
import type { Room } from "@rumi/protocol";
import type { UpdateRoomResponse } from "@rumi/protocol";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function RoomTitle({ room }: { room: Room }) {
  const [editing, setEditing] = useState(false);
  const title = room.name?.trim() || room.slug;
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  // Pressing Enter calls commit(), then setEditing(false) unmounts the
  // <input>, which fires onBlur, which calls commit() again before the PATCH
  // resolves. Guard with a ref so the second call is a no-op.
  const committingRef = useRef(false);
  const updateRoom = useRoomsStore((s) => s.updateRoom);

  useEffect(() => {
    setDraft(title);
  }, [title]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      committingRef.current = false;
    }
  }, [editing]);

  async function commit() {
    if (committingRef.current) return;
    committingRef.current = true;
    const next = draft.trim();
    if (next === (room.name ?? "")) {
      // Nothing changed — just close out.
      setEditing(false);
      return;
    }
    try {
      const updated = await apiFetch<UpdateRoomResponse>(`/api/rooms/${room.slug}`, {
        method: "PATCH",
        body: { name: next || null },
      });
      updateRoom(updated.room);
      setEditing(false);
    } catch (err: unknown) {
      // Keep the input open with the draft preserved so the user can
      // retry — previously we closed editing even on failure and the
      // draft was lost.
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't rename room");
      committingRef.current = false;
      inputRef.current?.focus();
    }
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

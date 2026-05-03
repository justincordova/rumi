import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { useRoomsStore } from "@/stores/rooms";
import type { CreateRoomResponse, TrashedRoom } from "@rumi/protocol";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const PURGE_DAYS = 30;

function purgeMessage(deletedAt: string | null): string {
  if (!deletedAt) return "Will be permanently deleted soon";
  const purgeMs = new Date(deletedAt).getTime() + PURGE_DAYS * 24 * 60 * 60 * 1000;
  const remaining = purgeMs - Date.now();
  if (remaining <= 0) return "Will be permanently deleted soon";
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  return `Will be permanently deleted in ${days} day${days === 1 ? "" : "s"}`;
}

export function TrashDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trashed = useRoomsStore((s) => s.trashed);
  const trashStatus = useRoomsStore((s) => s.trashStatus);
  const fetchTrash = useRoomsStore((s) => s.fetchTrash);
  const removeTrashedRoom = useRoomsStore((s) => s.removeTrashedRoom);
  const fetchRooms = useRoomsStore((s) => s.fetch);

  useEffect(() => {
    if (open) void fetchTrash();
  }, [open, fetchTrash]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Soft-deleted rooms are kept for {PURGE_DAYS} days. After that they are permanently
            removed.
          </DialogDescription>
        </DialogHeader>

        {trashStatus === "loading" && (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        )}
        {trashStatus === "error" && (
          <p className="text-sm text-destructive py-6 text-center">Failed to load trash</p>
        )}
        {trashStatus === "ready" && trashed.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">Trash is empty.</p>
        )}
        {trashStatus === "ready" && trashed.length > 0 && (
          <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {trashed.map((r) => (
              <TrashRow
                key={r.id}
                room={r}
                onRestored={() => {
                  removeTrashedRoom(r.slug);
                  void fetchRooms();
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TrashRow({ room, onRestored }: { room: TrashedRoom; onRestored: () => void }) {
  const [pending, setPending] = useState(false);

  async function restore() {
    setPending(true);
    try {
      await apiFetch<CreateRoomResponse>(`/api/rooms/${room.slug}/restore`, { method: "POST" });
      toast.success(`Restored ${room.name ?? room.slug}`);
      onRestored();
    } catch (err: unknown) {
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't restore room");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{room.name?.trim() || room.slug}</p>
        <p className="text-xs text-muted-foreground">{purgeMessage(room.deletedAt)}</p>
      </div>
      <button
        type="button"
        onClick={restore}
        disabled={pending}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
    </li>
  );
}

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
import { apiFetch } from "@/lib/api";
import { useRoomsStore } from "@/stores/rooms";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
}

export function DeleteRoomDialog({ open, onOpenChange, slug }: Props) {
  const removeRoom = useRoomsStore((s) => s.removeRoom);
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);
    try {
      await apiFetch(`/api/rooms/${slug}`, { method: "DELETE" });
      removeRoom(slug);
      toast.success("Room deleted");
      onOpenChange(false);
    } catch (err: unknown) {
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't delete room");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this room?</AlertDialogTitle>
          <AlertDialogDescription>
            This soft-deletes the room and removes it from your dashboard. The room's content is
            preserved but inaccessible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // preventDefault stops Radix from closing the dialog on click.
              // Without it the dialog unmounts immediately, the spinner state
              // is never visible, and a failed delete loses the confirmation
              // affordance. confirm() closes the dialog on success itself.
              e.preventDefault();
              e.stopPropagation();
              confirm();
            }}
            disabled={submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {submitting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

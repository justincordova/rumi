import { Button } from "@/components/ui/button";
import type { Room } from "@rumi/protocol";
import { Check, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function shareDesc(room: Room): string {
  if (room.visibility === "private") {
    if (room.guestAccess === "view") return "Invitees only. Guests can view.";
    if (room.guestAccess === "edit") return "Invitees only. Guests can edit.";
    return "Invitees only.";
  }
  if (room.guestAccess === "view") return "Anyone can view. Sign in to edit.";
  if (room.guestAccess === "edit") return "Anyone with this link can edit.";
  return "Anyone signed in can join and edit.";
}

export function ShareButton({ room }: { room: Room }) {
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

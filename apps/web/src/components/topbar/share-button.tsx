import { Button } from "@/components/ui/button";
import type { Room } from "@rumi/protocol";
import { Check, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function ShareButton({ room }: { room: Room }) {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? Check : Link2;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy link");
    }
  }

  if (room.visibility !== "open") return null;

  return (
    <Button variant="ghost" size="icon" onClick={handleCopy} className="h-8 w-8">
      <Icon className="h-4 w-4" />
    </Button>
  );
}

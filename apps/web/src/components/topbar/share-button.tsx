import { Button } from "@/components/ui/button";
import type { Room } from "@rumi/protocol";
import { Check, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function ShareButton({ room }: { room: Room }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Icon = copied ? Check : Link2;

  // Clear any pending revert-timer on unmount so it can't fire setCopied()
  // on an unmounted component (React 18 dev warning + wasted render).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy link");
    }
  }

  if (room.visibility !== "open") return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className="h-8 w-8"
      aria-label={copied ? "Link copied" : "Copy room link"}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

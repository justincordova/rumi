import { signInWithProvider } from "@/lib/auth";
import { X } from "lucide-react";
import { useState } from "react";

interface Props {
  slug: string;
  readOnly: boolean;
}

export function GuestBanner({ slug, readOnly }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(`rumi_guest_banner_${slug}`) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed || !readOnly) return null;

  return (
    <div className="flex-none border-b border-border bg-muted/50 px-4 py-2 flex items-center justify-center gap-3 shrink-0">
      <span className="text-sm text-muted-foreground">Sign in to edit this room</span>
      <button
        type="button"
        onClick={() => signInWithProvider("github", `/r/${slug}`)}
        className="rounded-sm text-sm font-medium text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Sign in
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(`rumi_guest_banner_${slug}`, "1");
          } catch {
            // storage unavailable — banner reappears on refresh
          }
        }}
        className="ml-2 grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

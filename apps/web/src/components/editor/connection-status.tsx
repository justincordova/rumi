import { useEffect, useRef } from "react";
import { toast } from "sonner";

type Status = "connecting" | "connected" | "disconnected";

interface Props {
  status: Status;
}

export function ConnectionStatus({ status }: Props) {
  const prevRef = useRef<Status>(status);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = status;

    // Show toast on first transition to disconnected.
    if (prev !== "disconnected" && status === "disconnected") {
      toast.warning("Disconnected — retrying", { id: "ws-status", duration: 999999 });
    }
    // Dismiss the toast whenever we reach "connected". The reconnect sequence
    // is disconnected → connecting → connected, so gating dismiss on a direct
    // disconnected → connected transition never fired and left the
    // infinite-duration toast pinned for the rest of the session. Dismissing
    // an absent toast id is a no-op, so this is safe on every connected.
    if (status === "connected") {
      toast.dismiss("ws-status");
    }
  }, [status]);

  // Dismiss the (effectively infinite-duration) disconnect toast on unmount —
  // e.g. navigating away from the room while still disconnected. Without this
  // the toast lives in the app-root <Toaster> forever and stays pinned across
  // the rest of the session.
  useEffect(() => {
    return () => {
      toast.dismiss("ws-status");
    };
  }, []);

  if (status === "connected") return null;

  if (status === "disconnected") {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] font-medium text-warning shadow-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        Disconnected — retrying
      </div>
    );
  }

  // Connecting
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-muted bg-surface/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse-soft" />
      Reconnecting…
    </div>
  );
}

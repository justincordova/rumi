import type { Room } from "@rumi/protocol";

export function VisibilityBadge({ room }: { room: Room }) {
  const label = room.visibility === "private" ? "Private" : "Open";
  return (
    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

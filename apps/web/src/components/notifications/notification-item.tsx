import type { Notification } from "@rumi/protocol";
import { useRouter } from "@tanstack/react-router";
import { MailOpen, UserPlus } from "lucide-react";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface NotificationItemProps {
  notification: Notification;
  onRead: (id: string) => void;
}

export function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const router = useRouter();
  const { id, type, payload, readAt, createdAt } = notification;
  const isUnread = !readAt;

  const slug = "roomSlug" in payload ? payload.roomSlug : null;

  function getSummary() {
    if (type === "invite_received" && "invitedBy" in payload) {
      const name = payload.invitedBy.displayName ?? "Someone";
      const room = payload.roomName ?? payload.roomSlug;
      return `${name} invited you to "${room}"`;
    }
    if (type === "invite_accepted" && "accepterName" in payload) {
      const name = payload.accepterName ?? "Someone";
      const room = payload.roomName ?? payload.roomSlug;
      return `${name} joined your room "${room}"`;
    }
    return "New notification";
  }

  function handleClick() {
    onRead(id);
    if (slug) {
      router.navigate({ to: "/r/$slug", params: { slug }, search: { tab: undefined } });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-muted/60 ${isUnread ? "bg-muted/30" : ""}`}
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        {type === "invite_received" ? (
          <UserPlus className="h-3.5 w-3.5 text-foreground/70" />
        ) : (
          <MailOpen className="h-3.5 w-3.5 text-foreground/70" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p
          className={`text-[13px] leading-snug ${isUnread ? "font-medium" : "text-muted-foreground"}`}
        >
          {getSummary()}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{formatRelativeTime(createdAt)}</p>
      </div>
      {isUnread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}

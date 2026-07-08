import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { NotificationItem } from "./notification-item";
import { useNotifications } from "./use-notifications";

export function BellPopover() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 relative"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <span className="text-[13px] font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-sm text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Mark all as read
            </button>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-[13px] text-muted-foreground">No notifications yet</span>
            </div>
          ) : (
            <div className="px-1">
              {items.map((n) => (
                <NotificationItem key={n.id} notification={n} onRead={(id) => markRead([id])} />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

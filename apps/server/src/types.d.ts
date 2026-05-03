import type { NotificationsService } from "@/notifications/service";
import type { Service } from "@/rooms/service";
import type { TabsService } from "@/rooms/tabs.service";
import type { Hocuspocus } from "@hocuspocus/server";

declare module "fastify" {
  interface FastifyInstance {
    notifications: NotificationsService;
    service: Service;
    tabsService: TabsService;
    hocuspocus: Hocuspocus;
    dropRoomConnections: (roomId: string) => Promise<void>;
    closeTabConnections: (tabId: string) => void;
    dropUserConnections: (userId: string) => void;
    dropConnectionForUserInRoom: (roomId: string, userId: string) => void;
  }
}

import type { Service } from "@/rooms/service";
import type { TabsService } from "@/rooms/tabs.service";
import type { Hocuspocus } from "@hocuspocus/server";

declare module "fastify" {
  interface FastifyInstance {
    service: Service;
    tabsService: TabsService;
    hocuspocus: Hocuspocus;
    dropRoomConnections: (roomId: string) => Promise<void>;
    closeTabConnections: (tabId: string) => void;
  }
}

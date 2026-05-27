import {
  broadcastTabsCreated,
  broadcastTabsDeleted,
  broadcastTabsReordered,
  broadcastTabsUpdated,
} from "@/sync/control";
import {
  CreateTabBody,
  ReorderTabsBody,
  SlugParam,
  TabIdParams,
  UpdateTabBody,
} from "@rumi/protocol";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { serializeTab } from "./serialize";

export const tabsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get("/:slug/tabs", { schema: { params: SlugParam } }, async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const tabs = await app.tabsService.listTabs(req.params.slug, req.user!.id);
    return { tabs: tabs.map(serializeTab) };
  });

  typed.post(
    "/:slug/tabs",
    { schema: { params: SlugParam, body: CreateTabBody } },
    async (req, reply) => {
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      const tab = await app.tabsService.createTab(req.params.slug, req.user!.id, req.body);
      const serialized = serializeTab(tab);
      app.log.info({ userId: req.user?.id, tabId: tab.id, type: tab.type }, "tab created");
      void broadcastTabsCreated(app.hocuspocus, tab.roomId, serialized);
      return reply.code(201).send({ tab: serialized });
    },
  );

  typed.patch(
    "/:slug/tabs/:tabId",
    { schema: { params: TabIdParams, body: UpdateTabBody } },
    async (req) => {
      const tab = await app.tabsService.updateTab(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.params.tabId,
        req.body,
      );
      const serialized = serializeTab(tab);
      app.log.info({ userId: req.user?.id, tabId: tab.id }, "tab updated");
      void broadcastTabsUpdated(app.hocuspocus, tab.roomId, serialized);
      return { tab: serialized };
    },
  );

  typed.post(
    "/:slug/tabs/reorder",
    { schema: { params: SlugParam, body: ReorderTabsBody } },
    async (req) => {
      const reordered = await app.tabsService.reorderTabs(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.body.tabIds,
      );
      const serialized = reordered.map(serializeTab);
      // Guard explicitly: passing `""` to broadcastTabsReordered would open
      // a Hocuspocus direct connection named `room:` which fails UUID
      // validation in onAuthenticate but bypasses auth via openDirectConnection
      // — it'd silently create a stray document.
      const firstRoomId = serialized[0]?.roomId;
      if (firstRoomId) {
        void broadcastTabsReordered(app.hocuspocus, firstRoomId, serialized);
      }
      return { tabs: serialized };
    },
  );

  typed.delete("/:slug/tabs/:tabId", { schema: { params: TabIdParams } }, async (req, reply) => {
    const { tabId, roomId } = await app.tabsService.deleteTab(
      req.params.slug,
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      req.user!.id,
      req.params.tabId,
    );
    app.closeTabConnections(tabId);
    app.log.info({ userId: req.user?.id, tabId }, "tab deleted");
    void broadcastTabsDeleted(app.hocuspocus, roomId, tabId);
    return reply.code(204).send();
  });
};

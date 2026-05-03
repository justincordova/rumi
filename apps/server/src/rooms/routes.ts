import {
  AddToBlacklistBody,
  AddToWhitelistBody,
  BlacklistIdParams,
  CreateRoomBody,
  MemberIdParams,
  SlugParam,
  TransferOwnershipBody,
  UpdateMemberRoleBody,
  UpdateRoomBody,
  WhitelistIdParams,
} from "@rumi/protocol";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  serializeBlacklistEntry,
  serializeRoom,
  serializeTab,
  serializeWhitelistEntry,
} from "./serialize";

export const roomsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post("/", { schema: { body: CreateRoomBody } }, async (req, reply) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const room = await app.service.createRoom({ ownerId: req.user!.id, ...req.body });
    return reply.code(201).send({ room: serializeRoom(room) });
  });

  typed.get("/", async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const roomList = await app.service.listRooms(req.user!.id, req.user!.email);
    return {
      rooms: roomList.map((r) => ({
        ...serializeRoom(r),
        pendingAccess: r.pendingAccess,
        ...(r.pendingWhitelistId ? { pendingWhitelistId: r.pendingWhitelistId } : {}),
      })),
    };
  });

  typed.get("/trash", async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const trashed = await app.service.listTrashedRooms(req.user!.id);
    return {
      rooms: trashed.map((r) => ({
        ...serializeRoom(r),
        deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
      })),
    };
  });

  typed.post("/:slug/restore", { schema: { params: SlugParam } }, async (req, reply) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const room = await app.service.restoreRoom(req.params.slug, req.user!.id);
    return reply.code(200).send({ room: serializeRoom(room) });
  });

  typed.get("/:slug", { schema: { params: SlugParam } }, async (req) => {
    const { room, role, tabs } = await app.service.getRoomBySlug(
      req.params.slug,
      req.user?.id,
      req.user?.email,
    );
    return {
      room: serializeRoom(room),
      role,
      tabs: tabs.map(serializeTab),
    };
  });

  typed.patch("/:slug", { schema: { params: SlugParam, body: UpdateRoomBody } }, async (req) => {
    const { room, sideEffectsNeeded } = await app.service.updateRoom(
      req.params.slug,
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      req.user!.id,
      req.body,
    );
    if (sideEffectsNeeded) await app.dropRoomConnections(room.id);
    return { room: serializeRoom(room) };
  });

  typed.delete("/:slug", { schema: { params: SlugParam } }, async (req, reply) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const { roomId } = await app.service.softDeleteRoom(req.params.slug, req.user!.id);
    await app.dropRoomConnections(roomId);
    return reply.code(204).send();
  });

  // Whitelist
  typed.post(
    "/:slug/whitelist",
    { schema: { params: SlugParam, body: AddToWhitelistBody } },
    async (req, reply) => {
      const entry = await app.service.addToWhitelist(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.body.email,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.email,
      );
      return reply.code(201).send({ entry: serializeWhitelistEntry(entry) });
    },
  );

  typed.get("/:slug/whitelist", { schema: { params: SlugParam } }, async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const entries = await app.service.listWhitelist(req.params.slug, req.user!.id);
    return { entries: entries.map(serializeWhitelistEntry) };
  });

  typed.delete(
    "/:slug/whitelist/:id",
    { schema: { params: WhitelistIdParams } },
    async (req, reply) => {
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      await app.service.removeFromWhitelist(req.params.slug, req.params.id, req.user!.id);
      return reply.code(204).send();
    },
  );

  // Blacklist
  typed.post(
    "/:slug/blacklist",
    { schema: { params: SlugParam, body: AddToBlacklistBody } },
    async (req, reply) => {
      const entry = await app.service.addToBlacklist(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.body.email,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.email,
      );
      return reply.code(201).send({ entry: serializeBlacklistEntry(entry) });
    },
  );

  typed.get("/:slug/blacklist", { schema: { params: SlugParam } }, async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const entries = await app.service.listBlacklist(req.params.slug, req.user!.id);
    return { entries: entries.map(serializeBlacklistEntry) };
  });

  typed.delete(
    "/:slug/blacklist/:id",
    { schema: { params: BlacklistIdParams } },
    async (req, reply) => {
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
      await app.service.removeFromBlacklist(req.params.slug, req.params.id, req.user!.id);
      return reply.code(204).send();
    },
  );

  // Members
  typed.get("/:slug/members", { schema: { params: SlugParam } }, async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const members = await app.service.listMembers(req.params.slug, req.user!.id);
    return {
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        displayName: m.displayName,
        email: m.email,
        avatarUrl: m.avatarUrl,
        joinedAt: m.joinedAt.toISOString(),
      })),
    };
  });

  typed.delete("/:slug/members/me", { schema: { params: SlugParam } }, async (req, reply) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const { roomId } = await app.service.leaveRoom(req.params.slug, req.user!.id);
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    app.dropConnectionForUserInRoom(roomId, req.user!.id);
    return reply.code(204).send();
  });

  typed.delete(
    "/:slug/members/:userId",
    { schema: { params: MemberIdParams } },
    async (req, reply) => {
      const { roomId, kickeeId } = await app.service.kickMember(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.params.userId,
      );
      app.dropConnectionForUserInRoom(roomId, kickeeId);
      return reply.code(204).send();
    },
  );

  typed.patch(
    "/:slug/members/:userId",
    { schema: { params: MemberIdParams, body: UpdateMemberRoleBody } },
    async (req, reply) => {
      await app.service.updateMemberRole(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.params.userId,
        req.body.role,
      );
      return reply.code(204).send();
    },
  );

  typed.post(
    "/:slug/transfer-ownership",
    { schema: { params: SlugParam, body: TransferOwnershipBody } },
    async (req) => {
      const { room, roomId } = await app.service.transferOwnership(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.body.newOwnerId,
      );
      await app.dropRoomConnections(roomId);
      return { room: serializeRoom(room) };
    },
  );
};

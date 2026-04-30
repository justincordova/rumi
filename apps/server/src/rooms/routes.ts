import {
  CreateInviteBody,
  CreateRoomBody,
  InviteIdParams,
  SlugParam,
  UpdateRoomBody,
} from "@rumi/protocol";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { serializeInvite, serializeRoom, serializeTab } from "./serialize";

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
      rooms: roomList.map((r) => ({ ...serializeRoom(r), pendingInvite: r.pendingInvite })),
    };
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

  typed.post(
    "/:slug/invites",
    { schema: { params: SlugParam, body: CreateInviteBody } },
    async (req, reply) => {
      const invite = await app.service.createInvite(
        req.params.slug,
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
        req.user!.id,
        req.body.email,
      );
      return reply.code(201).send({ invite: serializeInvite(invite) });
    },
  );

  typed.get("/:slug/invites", { schema: { params: SlugParam } }, async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const invites = await app.service.listInvites(req.params.slug, req.user!.id);
    return { invites: invites.map(serializeInvite) };
  });

  typed.delete("/:slug/invites/:id", { schema: { params: InviteIdParams } }, async (req, reply) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    await app.service.revokeInvite(req.params.slug, req.params.id, req.user!.id);
    return reply.code(204).send();
  });
};

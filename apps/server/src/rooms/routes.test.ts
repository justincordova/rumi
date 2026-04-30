import { beforeAll, describe, expect, it, mock } from "bun:test";

// Mock DB client before loading server to avoid real DB connection
mock.module("@/db/client", () => ({ db: {}, closeDb: async () => {} }));

// Mock JWKS before auth modules load
mock.module("jose", () => ({
  createRemoteJWKSet: mock(() => "mock-jwks"),
  jwtVerify: mock(async () => ({
    payload: { sub: "user-id", email: "user@example.com" },
  })),
}));

const { buildServer } = await import("@/server");

const mockService = {
  createRoom: mock(async () => ({
    id: "room-id",
    slug: "test-slug",
    name: null,
    ownerId: "user-id",
    visibility: "open" as const,
    guestAccess: "none" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  })),
  listRooms: mock(async () => []),
  getRoomBySlug: mock(async () => ({
    room: {
      id: "room-id",
      slug: "test-slug",
      name: null,
      ownerId: "user-id",
      visibility: "open" as const,
      guestAccess: "none" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    role: "owner" as const,
    tabs: [],
  })),
  updateRoom: mock(async (_slug: string, _userId: string, body: Record<string, unknown>) => ({
    room: {
      id: "room-id",
      slug: "test-slug",
      name: null,
      ownerId: "user-id",
      visibility: (body.visibility ?? "open") as const,
      guestAccess: (body.guestAccess ?? "none") as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    sideEffectsNeeded: body.visibility !== undefined || body.guestAccess !== undefined,
  })),
  softDeleteRoom: mock(async () => ({ roomId: "room-id" })),
  createInvite: mock(async () => ({
    id: "invite-id",
    roomId: "room-id",
    invitedEmail: "a@b.com",
    invitedBy: "user-id",
    createdAt: new Date(),
    acceptedAt: null,
  })),
  listInvites: mock(async () => []),
  revokeInvite: mock(async () => {}),
};

const mockDropRoomConnections = mock(async () => {});

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  // Override the service with mock
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).service = mockService;
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).dropRoomConnections = mockDropRoomConnections;
});

const authHeader = { authorization: "Bearer valid.token.here" };

describe("rooms routes", () => {
  it("POST / — creates room with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: authHeader,
      payload: { name: "Test Room" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { room: { slug: string } };
    expect(body.room.slug).toBe("test-slug");
  });

  it("GET / — lists rooms", async () => {
    const res = await app.inject({ method: "GET", url: "/api/rooms", headers: authHeader });
    expect(res.statusCode).toBe(200);
  });

  it("GET /:slug — returns room", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/rooms/test-slug",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
  });

  it("PATCH /:slug with name-only — does NOT call dropRoomConnections", async () => {
    mockDropRoomConnections.mockClear();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/rooms/test-slug",
      headers: authHeader,
      payload: { name: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockDropRoomConnections).not.toHaveBeenCalled();
  });

  it("PATCH /:slug with visibility change — calls dropRoomConnections once", async () => {
    mockDropRoomConnections.mockClear();
    // Return sideEffectsNeeded:true
    mockService.updateRoom.mockImplementationOnce(async () => ({
      room: {
        id: "room-id",
        slug: "test-slug",
        name: null,
        ownerId: "user-id",
        visibility: "private" as const,
        guestAccess: "none" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      sideEffectsNeeded: true,
    }));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/rooms/test-slug",
      headers: authHeader,
      payload: { visibility: "private" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockDropRoomConnections).toHaveBeenCalledTimes(1);
  });

  it("DELETE /:slug — calls dropRoomConnections and returns 204", async () => {
    mockDropRoomConnections.mockClear();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/rooms/test-slug",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(204);
    expect(mockDropRoomConnections).toHaveBeenCalledTimes(1);
  });

  it("GET /api/rooms without auth — returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/rooms" });
    expect(res.statusCode).toBe(401);
  });
});

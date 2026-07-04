import { beforeAll, describe, expect, it, mock } from "bun:test";

// Mock DB client before loading server to avoid real DB connection
mock.module("@/db/client", () => ({ db: {}, closeDb: async () => {} }));

mock.module("jose", () => ({
  createRemoteJWKSet: mock(() => "mock-jwks"),
  jwtVerify: mock(async () => ({
    payload: { sub: "user-id", email: "user@example.com" },
  })),
}));

mock.module("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    PORT: 3000,
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SUPABASE_JWKS_URL: "https://test.supabase.co/auth/v1/.well-known/jwks.json",
    SUPABASE_JWT_ISSUER: "https://test.supabase.co/auth/v1",
    SUPABASE_JWT_AUDIENCE: "authenticated",
    WEB_ORIGIN: "http://localhost:5173",
    WEB_URL: "http://localhost:5173",
    PUBLIC_API_URL: "http://localhost:3000",
  },
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
  addToWhitelist: mock(async () => ({
    id: "whitelist-id",
    roomId: "room-id",
    email: "a@b.com",
    createdAt: new Date(),
  })),
  listWhitelist: mock(async () => []),
  removeFromWhitelist: mock(async () => {}),
  addToBlacklist: mock(async () => ({
    id: "bl-id",
    roomId: "room-id",
    email: "a@b.com",
    createdAt: new Date(),
  })),
  listBlacklist: mock(async () => []),
  removeFromBlacklist: mock(async () => {}),
  listMembers: mock(async () => []),
  kickMember: mock(async () => ({ roomId: "room-id", kickeeId: "kickee-id" })),
  leaveRoom: mock(async () => ({ roomId: "room-id" })),
  updateMemberRole: mock(async () => ({ roomId: "room-id" })),
  transferOwnership: mock(async () => ({
    room: {
      id: "room-id",
      slug: "test-slug",
      name: null,
      ownerId: "new-owner",
      visibility: "open" as const,
      guestAccess: "none" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    roomId: "room-id",
  })),
  listTrashedRooms: mock(async () => []),
  restoreRoom: mock(async () => ({
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
};

const mockDropRoomConnections = mock(async () => {});
const mockDropConnectionForUserInRoom = mock(async () => {});

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  // Override the service with mock
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).service = mockService;
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).dropRoomConnections = mockDropRoomConnections;
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).dropConnectionForUserInRoom = mockDropConnectionForUserInRoom;
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

  it("GET /api/rooms/trash without auth — returns 401, not 500", async () => {
    // Regression: the optional-auth slug pattern used to capture the static
    // "trash" segment, letting anonymous requests reach a handler that
    // dereferences req.user and crashes.
    const res = await app.inject({ method: "GET", url: "/api/rooms/trash" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/rooms/:slug with a query string still gets optional auth", async () => {
    // Regression: raw-URL regex matching missed URLs with query strings,
    // flipping anonymous room reads from optional-auth to 401.
    const res = await app.inject({ method: "GET", url: "/api/rooms/test-slug?x=1" });
    expect(res.statusCode).not.toBe(401);
  });

  it("POST /:slug/whitelist — adds to whitelist with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms/test-slug/whitelist",
      headers: authHeader,
      payload: { email: "a@b.com" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { entry: { email: string } };
    expect(body.entry.email).toBe("a@b.com");
  });

  it("GET /:slug/whitelist — lists whitelist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/rooms/test-slug/whitelist",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
  });

  it("DELETE /:slug/whitelist/:id — removes entry with 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/rooms/test-slug/whitelist/00000000-0000-0000-0000-000000000001",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /:slug/blacklist — adds to blacklist with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms/test-slug/blacklist",
      headers: authHeader,
      payload: { email: "a@b.com" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("GET /:slug/blacklist — lists blacklist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/rooms/test-slug/blacklist",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
  });

  it("DELETE /:slug/blacklist/:id — removes entry with 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/rooms/test-slug/blacklist/00000000-0000-0000-0000-000000000002",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(204);
  });

  it("GET /:slug/members — lists members", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/rooms/test-slug/members",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
  });

  it("DELETE /:slug/members/me — leaves room with 204", async () => {
    mockDropConnectionForUserInRoom.mockClear();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/rooms/test-slug/members/me",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(204);
    expect(mockDropConnectionForUserInRoom).toHaveBeenCalledTimes(1);
  });

  it("DELETE /:slug/members/:userId — kicks with 204", async () => {
    mockDropConnectionForUserInRoom.mockClear();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/rooms/test-slug/members/00000000-0000-0000-0000-000000000003",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(204);
    expect(mockDropConnectionForUserInRoom).toHaveBeenCalledTimes(1);
  });

  it("PATCH /:slug/members/:userId — updates role with 204", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/rooms/test-slug/members/00000000-0000-0000-0000-000000000004",
      headers: authHeader,
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /:slug/transfer-ownership — transfers with 200", async () => {
    mockDropRoomConnections.mockClear();
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms/test-slug/transfer-ownership",
      headers: authHeader,
      payload: { newOwnerId: "00000000-0000-0000-0000-000000000005" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockDropRoomConnections).toHaveBeenCalledTimes(1);
  });
});

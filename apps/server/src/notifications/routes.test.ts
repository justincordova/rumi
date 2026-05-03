import { beforeAll, describe, expect, it, mock } from "bun:test";

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
    DATABABASE_URL: "postgresql://test:test@localhost:5432/test",
    SUPABASE_JWKS_URL: "https://test.supabase.co/auth/v1/.well-known/jwks.json",
    SUPABASE_JWT_ISSUER: "https://test.supabase.co/auth/v1",
    SUPABASE_JWT_AUDIENCE: "authenticated",
    WEB_ORIGIN: "http://localhost:5173",
    WEB_URL: "http://localhost:5173",
    PUBLIC_API_URL: "http://localhost:3000",
  },
}));

const { buildServer } = await import("@/server");

const now = new Date();

const uuidA = "00000000-0000-0000-0000-000000000001";

const samplePayload = {
  inviteId: uuidA,
  roomId: uuidA,
  roomSlug: "test-room",
  roomName: "Test Room",
  invitedBy: { userId: uuidA, displayName: "Alice" },
};

const mockNotifications = {
  recordNotification: mock(async () => ({
    id: uuidA,
    userId: "user-id",
    type: "invite_received",
    payload: samplePayload,
    readAt: null,
    createdAt: now,
  })),
  listNotifications: mock(async () => ({
    notifications: [
      {
        id: uuidA,
        userId: "user-id",
        type: "invite_received",
        payload: samplePayload,
        readAt: null,
        createdAt: now,
      },
    ],
    unreadCount: 1,
  })),
  markRead: mock(async () => {}),
  getPreferences: mock(async () => ({
    emailEnabled: true,
    inviteReceivedEmail: true,
    inviteAcceptedEmail: true,
  })),
  updatePreferences: mock(async (_userId: string, patch: Record<string, unknown>) => ({
    emailEnabled: true,
    inviteReceivedEmail: true,
    inviteAcceptedEmail: true,
    ...patch,
  })),
};

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).notifications = mockNotifications;
});

const authHeader = { Authorization: "Bearer valid.token.here" };

describe("notification routes", () => {
  describe("GET /api/notifications", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/api/notifications" });
      expect(res.statusCode).toBe(401);
    });

    it("returns notifications and unreadCount", async () => {
      mockNotifications.listNotifications.mockClear();
      const res = await app.inject({
        method: "GET",
        url: "/api/notifications",
        headers: authHeader,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { notifications: unknown[]; unreadCount: number };
      expect(body.notifications).toHaveLength(1);
      expect(body.unreadCount).toBe(1);
      expect(mockNotifications.listNotifications).toHaveBeenCalledWith("user-id", {});
    });
  });

  describe("POST /api/notifications/read", () => {
    it("marks specific ids as read", async () => {
      mockNotifications.markRead.mockClear();
      const res = await app.inject({
        method: "POST",
        url: "/api/notifications/read",
        headers: authHeader,
        payload: { ids: [uuidA] },
      });
      expect(res.statusCode).toBe(200);
      expect(mockNotifications.markRead).toHaveBeenCalledWith("user-id", { ids: [uuidA] });
    });

    it("marks all as read", async () => {
      mockNotifications.markRead.mockClear();
      const res = await app.inject({
        method: "POST",
        url: "/api/notifications/read",
        headers: authHeader,
        payload: { all: true },
      });
      expect(res.statusCode).toBe(200);
      expect(mockNotifications.markRead).toHaveBeenCalledWith("user-id", { all: true });
    });
  });

  describe("GET /api/notifications/preferences", () => {
    it("returns preferences", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/notifications/preferences",
        headers: authHeader,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { preferences: { emailEnabled: boolean } };
      expect(body.preferences.emailEnabled).toBe(true);
    });
  });

  describe("PATCH /api/notifications/preferences", () => {
    it("updates preferences", async () => {
      mockNotifications.updatePreferences.mockClear();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/notifications/preferences",
        headers: authHeader,
        payload: { emailEnabled: false },
      });
      expect(res.statusCode).toBe(200);
      expect(mockNotifications.updatePreferences).toHaveBeenCalledWith("user-id", {
        emailEnabled: false,
      });
    });
  });

  describe("POST /api/notifications/unsubscribe", () => {
    it("returns 400 for missing token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/notifications/unsubscribe",
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/notifications/unsubscribe?token=invalid",
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

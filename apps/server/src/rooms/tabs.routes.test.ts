import { beforeAll, describe, expect, it, mock } from "bun:test";
import { AppError } from "@/lib/errors";

mock.module("@/db/client", () => ({ db: {} }));
mock.module("jose", () => ({
  createRemoteJWKSet: mock(() => "mock-jwks"),
  jwtVerify: mock(async () => ({
    payload: { sub: "user-id", email: "user@example.com" },
  })),
}));

const { buildServer } = await import("@/server");

const baseTab = {
  id: "00000000-0000-0000-0000-000000000001",
  roomId: "00000000-0000-0000-0000-000000000002",
  type: "tab",
  language: "markdown",
  name: "Welcome",
  ordinal: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockTabsService = {
  listTabs: mock(async () => [baseTab]),
  createTab: mock(async () => baseTab),
  updateTab: mock(async () => baseTab),
  deleteTab: mock(async () => ({
    tabId: "00000000-0000-0000-0000-000000000001",
    roomId: "00000000-0000-0000-0000-000000000002",
  })),
};

const mockCloseTabConnections = mock((_tabId: string) => {});

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).tabsService = mockTabsService;
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (app as any).closeTabConnections = mockCloseTabConnections;
});

const authHeader = { authorization: "Bearer valid.token.here" };

describe("tabs routes", () => {
  it("POST /:slug/tabs creates tab with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms/test-slug/tabs",
      headers: authHeader,
      payload: { type: "tab" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /:slug/tabs returns 422 on tab_limit_reached", async () => {
    mockTabsService.createTab.mockImplementationOnce(async () => {
      throw new AppError("tab_limit_reached", "Max 3 tabs per room", 422);
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms/test-slug/tabs",
      headers: authHeader,
      payload: { type: "tab" },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error?: { code: string }; code?: string };
    // Fastify error handler wraps AppError in { error: { code, message } }
    expect(body.error?.code ?? body.code).toBe("tab_limit_reached");
  });

  it("POST /:slug/tabs drawing with language returns 422", async () => {
    mockTabsService.createTab.mockImplementationOnce(async () => {
      throw new AppError("validation_failed", "Drawing tabs cannot have a language", 422);
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms/test-slug/tabs",
      headers: authHeader,
      payload: { type: "drawing", language: "markdown" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("PATCH /:slug/tabs/:tabId updates tab", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/rooms/test-slug/tabs/00000000-0000-0000-0000-000000000001",
      headers: authHeader,
      payload: { name: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCloseTabConnections).not.toHaveBeenCalled();
  });

  it("DELETE /:slug/tabs/:tabId calls closeTabConnections and returns 204", async () => {
    mockCloseTabConnections.mockClear();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/rooms/test-slug/tabs/00000000-0000-0000-0000-000000000001",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(204);
    expect(mockCloseTabConnections).toHaveBeenCalledTimes(1);
    expect(mockCloseTabConnections).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
  });

  it("DELETE /:slug/tabs/:tabId returns 422 on last_tab", async () => {
    mockTabsService.deleteTab.mockImplementationOnce(async () => {
      throw new AppError("last_tab", "Cannot delete last tab", 422);
    });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/rooms/test-slug/tabs/00000000-0000-0000-0000-000000000001",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(422);
  });
});

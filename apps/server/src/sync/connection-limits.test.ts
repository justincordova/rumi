import { describe, expect, it, mock } from "bun:test";
import { AppError } from "@/lib/errors";
import { enforceConnectionLimits } from "./connection-limits";

mock.module("@/rooms/plan", () => ({
  getUserPlan: mock(async () => ({
    plan: "free",
    maxRooms: 3,
    maxTabsPerRoom: 3,
    maxConcurrentUsers: 5,
  })),
  MAX_ROOMS_OPEN: 10,
}));

const planMod = await import("@/rooms/plan");

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    documentName: "room:room-1",
    token: "test",
    instance: {
      documents: new Map(),
    },
    context: {
      roomId: "room-1",
      roomOwner: "owner-1",
      user: { id: "user-1" },
    },
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any;
}

function makeConnection(ctx: Record<string, unknown>) {
  return { context: ctx, socketId: `socket-${Math.random()}` };
}

function makeDoc(connections: Array<ReturnType<typeof makeConnection>>) {
  return { getConnections: () => connections };
}

describe("enforceConnectionLimits", () => {
  it("passes when under concurrent user limit", async () => {
    const existingConn = makeConnection({
      roomId: "room-1",
      user: { id: "user-other" },
    });
    const docs = new Map([["room:room-1", makeDoc([existingConn])]]);
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload)).resolves.toBeUndefined();
  });

  it("throws plan_limit_reached when at concurrent user limit", async () => {
    planMod.getUserPlan.mockImplementationOnce(async () => ({
      plan: "free",
      maxRooms: 3,
      maxTabsPerRoom: 3,
      maxConcurrentUsers: 2,
    }));
    const conns = [
      makeConnection({ roomId: "room-1", user: { id: "user-a" } }),
      makeConnection({ roomId: "room-1", user: { id: "user-b" } }),
    ];
    const docs = new Map([["room:room-1", makeDoc(conns)]]);
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload)).rejects.toBeInstanceOf(AppError);
  });

  it("skips enforcement for tab doc connections", async () => {
    const payload = makePayload({ documentName: "tab-uuid-123" });
    await expect(enforceConnectionLimits(payload)).resolves.toBeUndefined();
  });

  it("passes when under rooms-open limit", async () => {
    const userRooms = Array.from({ length: 5 }, (_, i) =>
      makeConnection({ roomId: `room-${i}`, user: { id: "user-1" } }),
    );
    const docs = new Map(userRooms.map((c, i) => [`room:room-${i}`, makeDoc([c])]));
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload)).resolves.toBeUndefined();
  });

  it("throws room_limit when at rooms-open limit", async () => {
    const userRooms = Array.from({ length: 10 }, (_, i) =>
      makeConnection({ roomId: `room-${i}`, user: { id: "user-1" } }),
    );
    const docs = new Map(userRooms.map((c, i) => [`room:room-${i}`, makeDoc([c])]));
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload)).rejects.toBeInstanceOf(AppError);
  });

  it("skips rooms-open check for guest users", async () => {
    const payload = makePayload({
      context: { roomId: "room-1", roomOwner: "owner-1", isGuest: true },
    });
    await expect(enforceConnectionLimits(payload)).resolves.toBeUndefined();
  });
});

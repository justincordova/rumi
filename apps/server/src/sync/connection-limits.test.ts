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
    // data.context is intentionally empty — Hocuspocus only merges the auth
    // result into context AFTER the hook returns, so enforceConnectionLimits
    // must rely on its `identity` argument, not `data.context`.
    context: {},
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any;
}

function makeIdentity(overrides: Partial<Parameters<typeof enforceConnectionLimits>[1]> = {}) {
  return {
    roomId: "room-1",
    roomOwner: "owner-1",
    userId: "user-1",
    ...overrides,
  };
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
    await expect(enforceConnectionLimits(payload, makeIdentity())).resolves.toBeUndefined();
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
    await expect(enforceConnectionLimits(payload, makeIdentity())).rejects.toBeInstanceOf(AppError);
  });

  it("counts unique users across multiple docs in the same room", async () => {
    planMod.getUserPlan.mockImplementationOnce(async () => ({
      plan: "free",
      maxRooms: 3,
      maxTabsPerRoom: 3,
      maxConcurrentUsers: 2,
    }));
    // Same user-a appears on the control doc and a tab doc — should count once.
    // user-b is on a tab doc. That's 2 unique → at limit → throw.
    const docs = new Map([
      ["room:room-1", makeDoc([makeConnection({ roomId: "room-1", user: { id: "user-a" } })])],
      [
        "tab-1",
        makeDoc([
          makeConnection({ roomId: "room-1", user: { id: "user-a" } }),
          makeConnection({ roomId: "room-1", user: { id: "user-b" } }),
        ]),
      ],
    ]);
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload, makeIdentity())).rejects.toBeInstanceOf(AppError);
  });

  it("ignores connections from other rooms when counting concurrent users", async () => {
    planMod.getUserPlan.mockImplementationOnce(async () => ({
      plan: "free",
      maxRooms: 3,
      maxTabsPerRoom: 3,
      maxConcurrentUsers: 2,
    }));
    const docs = new Map([
      ["room:room-1", makeDoc([makeConnection({ roomId: "room-1", user: { id: "user-a" } })])],
      [
        "room:room-2",
        makeDoc([
          makeConnection({ roomId: "room-2", user: { id: "user-b" } }),
          makeConnection({ roomId: "room-2", user: { id: "user-c" } }),
        ]),
      ],
    ]);
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload, makeIdentity())).resolves.toBeUndefined();
  });

  it("skips enforcement for tab doc connections", async () => {
    const payload = makePayload({ documentName: "tab-uuid-123" });
    await expect(enforceConnectionLimits(payload, makeIdentity())).resolves.toBeUndefined();
  });

  it("passes when under rooms-open limit", async () => {
    const userRooms = Array.from({ length: 5 }, (_, i) =>
      makeConnection({ roomId: `room-${i}`, user: { id: "user-1" } }),
    );
    const docs = new Map(userRooms.map((c, i) => [`room:room-${i}`, makeDoc([c])]));
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload, makeIdentity())).resolves.toBeUndefined();
  });

  it("throws room_limit when at rooms-open limit", async () => {
    const userRooms = Array.from({ length: 10 }, (_, i) =>
      makeConnection({ roomId: `room-${i}`, user: { id: "user-1" } }),
    );
    const docs = new Map(userRooms.map((c, i) => [`room:room-${i}`, makeDoc([c])]));
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload, makeIdentity())).rejects.toBeInstanceOf(AppError);
  });

  it("skips rooms-open check for guest users", async () => {
    const userRooms = Array.from({ length: 10 }, (_, i) =>
      makeConnection({ roomId: `room-${i}`, user: { id: "user-1" } }),
    );
    const docs = new Map(userRooms.map((c, i) => [`room:room-${i}`, makeDoc([c])]));
    const payload = makePayload({ instance: { documents: docs } });
    // Guests have no userId — rooms-open cap doesn't apply.
    await expect(
      enforceConnectionLimits(payload, makeIdentity({ userId: undefined })),
    ).resolves.toBeUndefined();
  });
});

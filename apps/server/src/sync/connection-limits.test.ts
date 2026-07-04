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

  it("enforces the concurrent-user cap on tab doc connections too", async () => {
    // A custom client connecting straight to a tab document (bypassing the
    // control doc) must still be counted — editing only requires tab docs.
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
    const payload = makePayload({ documentName: "tab-uuid-123", instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload, makeIdentity())).rejects.toBeInstanceOf(AppError);
  });

  it("admits an identity that is already counted, even at capacity", async () => {
    // Reconnect / second browser tab / tab doc following the control doc:
    // user-1 is already present, so admitting them adds no unique user.
    planMod.getUserPlan.mockImplementationOnce(async () => ({
      plan: "free",
      maxRooms: 3,
      maxTabsPerRoom: 3,
      maxConcurrentUsers: 2,
    }));
    const conns = [
      makeConnection({ roomId: "room-1", user: { id: "user-1" } }),
      makeConnection({ roomId: "room-1", user: { id: "user-b" } }),
    ];
    const docs = new Map([["room:room-1", makeDoc(conns)]]);
    const payload = makePayload({ instance: { documents: docs } });
    await expect(enforceConnectionLimits(payload, makeIdentity())).resolves.toBeUndefined();
  });

  it("counts a guest with multiple docs open as one user via guestId", async () => {
    planMod.getUserPlan.mockImplementationOnce(async () => ({
      plan: "free",
      maxRooms: 3,
      maxTabsPerRoom: 3,
      maxConcurrentUsers: 2,
    }));
    // One guest holds the control doc + two tab docs (3 sockets, 1 identity).
    const guestCtx = { roomId: "room-1", guestId: "guest:abc" };
    const docs = new Map([
      ["room:room-1", makeDoc([makeConnection(guestCtx)])],
      ["tab-1", makeDoc([makeConnection(guestCtx)])],
      ["tab-2", makeDoc([makeConnection(guestCtx)])],
    ]);
    const payload = makePayload({ instance: { documents: docs } });
    // A new signed-in user connects: 1 guest + them = 2 → exactly at cap after
    // admit, but the guest counted once so uniqueUsers.size is 1 → allowed.
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

  it("throws room_limit when opening a NEW room at the rooms-open limit", async () => {
    const userRooms = Array.from({ length: 10 }, (_, i) =>
      makeConnection({ roomId: `room-${i + 100}`, user: { id: "user-1" } }),
    );
    const docs = new Map(userRooms.map((c, i) => [`room:room-${i + 100}`, makeDoc([c])]));
    const payload = makePayload({ instance: { documents: docs } });
    // Connecting to room-1, which is NOT among the 10 open rooms.
    await expect(enforceConnectionLimits(payload, makeIdentity())).rejects.toBeInstanceOf(AppError);
  });

  it("allows reconnecting to an already-open room at the rooms-open limit", async () => {
    const userRooms = Array.from({ length: 10 }, (_, i) =>
      makeConnection({ roomId: `room-${i}`, user: { id: "user-1" } }),
    );
    const docs = new Map(userRooms.map((c, i) => [`room:room-${i}`, makeDoc([c])]));
    const payload = makePayload({ instance: { documents: docs } });
    // room-1 is among the open rooms — no new room is opened.
    await expect(enforceConnectionLimits(payload, makeIdentity())).resolves.toBeUndefined();
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

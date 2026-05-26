import { beforeAll, describe, expect, it, mock } from "bun:test";
import { AppError, AuthError } from "@/lib/errors";
import { getUserPlan } from "./plan";
import { createTabsService } from "./tabs.service";

mock.module("@/rooms/plan", () => ({
  getUserPlan: mock(async () => ({
    plan: "free",
    maxRooms: 3,
    maxTabsPerRoom: 3,
    maxConcurrentUsers: 5,
  })),
  PLAN_LIMITS: {
    free: { maxRooms: 3, maxTabsPerRoom: 3, maxConcurrentUsers: 5 },
    pro: { maxRooms: 25, maxTabsPerRoom: 10, maxConcurrentUsers: 15 },
    max: { maxRooms: 100, maxTabsPerRoom: 50, maxConcurrentUsers: 50 },
  },
  MAX_ROOMS_OPEN: 10,
}));

const planMod = await import("@/rooms/plan");

const baseRoom = {
  id: "room-id",
  slug: "test-slug",
  ownerId: "user-id",
  visibility: "open" as const,
  guestAccess: "none" as const,
  deletedAt: null,
};

const baseMember = {
  roomId: "room-id",
  userId: "user-id",
  role: "owner" as const,
};

const baseTab = {
  id: "tab-id",
  roomId: "room-id",
  type: "tab" as const,
  language: "markdown",
  name: "Welcome",
  ordinal: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeDb(overrides: Record<string, unknown> = {}) {
  const base = {
    insert: () => ({
      values: () => ({
        returning: async () => [{ ...baseTab, id: "new-tab-id" }],
        onConflictDoNothing: async () => [],
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ ...baseTab }],
        }),
      }),
    }),
    delete: () => ({
      where: () => ({ returning: async () => [] }),
    }),
    execute: async () => {},
    transaction: async (fn: (tx: unknown) => unknown) => fn(base),
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({ returning: async () => [{ count: 1 }] }),
          returning: async () => [{ count: 1 }],
        }),
      }),
    }),
    query: {
      rooms: {
        findFirst: async () => baseRoom,
      },
      roomMembers: {
        findFirst: async () => baseMember,
      },
      tabs: {
        findMany: async () => [baseTab],
        findFirst: async () => baseTab,
      },
    },
    ...overrides,
  };
  return base;
}

describe("createTabsService", () => {
  describe("createTab", () => {
    it("enforces tab cap from plan (tab_limit_reached)", async () => {
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const stubTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => [{ ordinal: 0 }, { ordinal: 1 }, { ordinal: 2 }],
                }),
              }),
            }),
            insert: () => ({
              values: () => ({
                returning: async () => [baseTab],
              }),
            }),
            query: makeDb().query,
          };
          return fn(stubTx);
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(db as any);
      await expect(svc.createTab("test-slug", "user-id", { type: "tab" })).rejects.toBeInstanceOf(
        AppError,
      );
    });

    it("respects pro plan tab limit of 10", async () => {
      planMod.getUserPlan.mockImplementationOnce(async () => ({
        plan: "pro",
        maxRooms: 25,
        maxTabsPerRoom: 10,
        maxConcurrentUsers: 15,
      }));
      const tabs = Array.from({ length: 10 }, (_, i) => ({ ordinal: i }));
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const stubTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => tabs,
                }),
              }),
            }),
            insert: () => ({
              values: () => ({
                returning: async () => [baseTab],
              }),
            }),
            query: makeDb().query,
          };
          return fn(stubTx);
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(db as any);
      await expect(svc.createTab("test-slug", "user-id", { type: "tab" })).rejects.toBeInstanceOf(
        AppError,
      );
    });

    it("rejects language on drawing tab (validation_failed)", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(makeDb() as any);
      await expect(
        svc.createTab("test-slug", "user-id", { type: "drawing", language: "markdown" }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("throws forbidden when user is not a member", async () => {
      const db = makeDb({
        query: {
          rooms: {
            findFirst: async () => baseRoom,
          },
          roomMembers: {
            findFirst: async () => null, // not a member
          },
          tabs: makeDb().query.tabs,
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(db as any);
      await expect(svc.createTab("test-slug", "user-id", { type: "tab" })).rejects.toBeInstanceOf(
        AuthError,
      );
    });
  });

  describe("updateTab", () => {
    it("rejects language on drawing tab", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          tabs: {
            ...makeDb().query.tabs,
            findFirst: async () => ({ ...baseTab, type: "drawing" as const, language: null }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(db as any);
      await expect(
        svc.updateTab("test-slug", "user-id", "tab-id", { language: "markdown" }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("throws not_found for missing tab", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          tabs: {
            ...makeDb().query.tabs,
            findFirst: async () => null,
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(db as any);
      await expect(
        svc.updateTab("test-slug", "user-id", "bad-tab-id", { name: "X" }),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  describe("deleteTab", () => {
    it("rejects deleting last tab (last_tab)", async () => {
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const stubTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: async () => [baseTab],
                }),
              }),
            }),
            delete: () => ({ where: () => ({ returning: async () => [] }) }),
            execute: async () => {},
          };
          return fn(stubTx);
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(db as any);
      await expect(svc.deleteTab("test-slug", "user-id", baseTab.id)).rejects.toBeInstanceOf(
        AppError,
      );
    });

    it("throws not_found for missing tab", async () => {
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const stubTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  // Two unrelated tabs in the room, neither matches the requested id.
                  for: async () => [
                    { ...baseTab, id: "00000000-0000-0000-0000-000000000010" },
                    { ...baseTab, id: "00000000-0000-0000-0000-000000000011" },
                  ],
                }),
              }),
            }),
            delete: () => ({ where: () => ({ returning: async () => [] }) }),
            execute: async () => {},
          };
          return fn(stubTx);
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createTabsService(db as any);
      await expect(svc.deleteTab("test-slug", "user-id", "missing-tab")).rejects.toBeInstanceOf(
        AuthError,
      );
    });
  });
});

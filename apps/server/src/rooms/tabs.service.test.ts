import { describe, expect, it } from "bun:test";
import { AppError, AuthError } from "@/lib/errors";
import { createTabsService } from "./tabs.service";

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
    it("enforces 3-tab cap (tab_limit_reached)", async () => {
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const stubTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => [{ count: 3 }],
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
            query: {
              tabs: {
                findFirst: async () => baseTab,
              },
            },
            select: () => ({
              from: () => ({
                where: () => [{ count: 1 }],
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
      await expect(svc.deleteTab("test-slug", "user-id", "tab-id")).rejects.toBeInstanceOf(
        AppError,
      );
    });

    it("throws not_found for missing tab", async () => {
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const stubTx = {
            query: {
              tabs: { findFirst: async () => null },
            },
            select: () => ({
              from: () => ({
                where: () => [{ count: 2 }],
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

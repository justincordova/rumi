import { beforeAll, describe, expect, it, mock } from "bun:test";

// Mock email module so tests don't need UNSUBSCRIBE_HMAC_SECRET or RESEND_API_KEY
mock.module("@/notifications/email", () => ({
  sendAccessGrantedEmail: mock(async () => {}),
}));

import { AppError, AuthError } from "@/lib/errors";
import { getUserPlan } from "./plan";
import { createService } from "./service";

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

// Minimal stub for a Drizzle-like query interface
function makeDb(overrides: Record<string, unknown> = {}) {
  const base = {
    execute: async (_query: unknown) => undefined,
    insert: () => ({
      values: () => ({
        returning: async () => [
          {
            id: "room-id",
            slug: "test-slug",
            name: null,
            ownerId: "user-id",
            visibility: "open",
            guestAccess: "none",
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
        ],
        onConflictDoNothing: async () => [],
      }),
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => [],
        }),
        // Returns a thenable-like that ALSO exposes `.for("update")` so a
        // chain like `select().from().where().for("update")` resolves to an
        // empty array while a bare `select().from().where()` still awaits
        // to `[{ count: 0 }]`.
        where: (..._args: unknown[]) =>
          Object.assign((async () => [{ count: 0 }])(), { for: async () => [] as unknown[] }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [
            {
              id: "room-id",
              slug: "test-slug",
              name: null,
              ownerId: "user-id",
              visibility: "open",
              guestAccess: "none",
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            },
          ],
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => [{ id: "invite-id" }],
      }),
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(base),
    query: {
      rooms: {
        findFirst: async () => ({
          id: "room-id",
          slug: "test-slug",
          name: null,
          ownerId: "user-id",
          visibility: "open",
          guestAccess: "none",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        }),
      },
      roomMembers: { findFirst: async () => null },
      roomWhitelist: {
        findFirst: async () => null,
        findMany: async () => [],
      },
      roomBlacklist: {
        findFirst: async () => null,
        findMany: async () => [],
      },
      tabs: {
        findMany: async () => [],
      },
    },
    ...overrides,
  };
  return base;
}

describe("createService", () => {
  describe("createRoom", () => {
    it("creates a room and returns it", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(makeDb() as any);
      const result = await svc.createRoom({ ownerId: "user-id", name: "My Room" });
      expect(result.slug).toBe("test-slug");
    });

    it("retries on slug collision (23506) and eventually throws server_error", async () => {
      let attempts = 0;
      const db = makeDb({
        transaction: async () => {
          attempts++;
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          const err: any = new Error("unique violation");
          err.code = "23505";
          err.constraint_name = "rooms_slug_unique";
          throw err;
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.createRoom({ ownerId: "user-id" })).rejects.toBeInstanceOf(AppError);
      expect(attempts).toBe(6);
    });

    it("throws plan_limit_reached when user is at room limit", async () => {
      planMod.getUserPlan.mockImplementationOnce(async () => ({
        plan: "free",
        maxRooms: 3,
        maxTabsPerRoom: 3,
        maxConcurrentUsers: 5,
      }));
      const atLimitRows = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
      const db = makeDb({
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: async () => [] }),
            // The new createRoom code reads the user's existing rooms via
            // `.for("update")`. Return 3 rows to simulate at-cap state.
            where: (..._args: unknown[]) =>
              Object.assign((async () => [{ count: 3 }])(), { for: async () => atLimitRows }),
          }),
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.createRoom({ ownerId: "user-id" })).rejects.toThrow(
        "Free plan limited to 3 rooms",
      );
    });

    it("creates room when user is under limit", async () => {
      planMod.getUserPlan.mockImplementationOnce(async () => ({
        plan: "free",
        maxRooms: 3,
        maxTabsPerRoom: 3,
        maxConcurrentUsers: 5,
      }));
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(makeDb() as any);
      const result = await svc.createRoom({ ownerId: "user-id" });
      expect(result.slug).toBe("test-slug");
    });

    it("coerces guestAccess to none when created private", async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const db = makeDb({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            inserted.push(v);
            return {
              returning: async () => [
                {
                  id: "room-id",
                  slug: "test-slug",
                  name: null,
                  ownerId: "user-id",
                  visibility: "private",
                  guestAccess: "none",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  deletedAt: null,
                },
              ],
              onConflictDoNothing: async () => [],
            };
          },
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await svc.createRoom({ ownerId: "user-id", visibility: "private", guestAccess: "edit" });
      const roomInsert = inserted.find((v) => "visibility" in v);
      expect(roomInsert?.guestAccess).toBe("none");
    });
  });

  describe("getRoomBySlug", () => {
    it("auto-joins open rooms for new members", async () => {
      const db = makeDb({
        query: {
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "other-user",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: { findFirst: async () => null }, // not a member
          roomWhitelist: { findFirst: async () => null, findMany: async () => [] },
          roomBlacklist: { findFirst: async () => null, findMany: async () => [] },
          tabs: { findMany: async () => [] },
        },
        insert: () => ({
          values: () => ({
            onConflictDoNothing: async () => [],
            returning: async () => [{ id: "member-id" }],
          }),
        }),
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: async () => [] }),
            where: async () => [],
          }),
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.getRoomBySlug("test", "new-user", "new@example.com");
      expect(result.role).toBe("member");
    });

    it("throws forbidden for private room with no access", async () => {
      const db = makeDb({
        query: {
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "other-user",
              visibility: "private",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: { findFirst: async () => null },
          roomWhitelist: { findFirst: async () => null, findMany: async () => [] },
          roomBlacklist: { findFirst: async () => null, findMany: async () => [] },
          tabs: { findMany: async () => [] },
        },
        insert: () => ({
          values: () => ({
            onConflictDoNothing: async () => [],
            returning: async () => [],
          }),
        }),
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: async () => [] }),
            where: async () => [],
          }),
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(
        svc.getRoomBySlug("test", "stranger", "stranger@example.com"),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it("guest with guest_access=none → throws forbidden", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "other-user",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      // No userId → guest path
      await expect(svc.getRoomBySlug("test")).rejects.toBeInstanceOf(AuthError);
    });

    it("guest with guest_access=view → returns role: null", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "other-user",
              visibility: "open",
              guestAccess: "view",
              deletedAt: null,
            }),
          },
          tabs: { findMany: async () => [] },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.getRoomBySlug("test");
      expect(result.role).toBeNull();
    });
  });

  describe("updateRoom", () => {
    it("returns sideEffectsNeeded:true when visibility changes", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "user-id",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const { sideEffectsNeeded } = await svc.updateRoom("test", "user-id", {
        visibility: "private",
      });
      expect(sideEffectsNeeded).toBe(true);
    });

    it("returns sideEffectsNeeded:true when guestAccess changes", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "user-id",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const { sideEffectsNeeded } = await svc.updateRoom("test", "user-id", {
        guestAccess: "view",
      });
      expect(sideEffectsNeeded).toBe(true);
    });

    it("returns sideEffectsNeeded:false for name-only update", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "user-id",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const { sideEffectsNeeded } = await svc.updateRoom("test", "user-id", { name: "New Name" });
      expect(sideEffectsNeeded).toBe(false);
    });

    it("throws forbidden for non-owner", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "other-user",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.updateRoom("test", "different-user", { name: "X" })).rejects.toBeInstanceOf(
        AuthError,
      );
    });
  });

  describe("softDeleteRoom", () => {
    it("throws forbidden for non-owner", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "owner",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.softDeleteRoom("test", "not-owner")).rejects.toBeInstanceOf(AuthError);
    });
  });

  describe("addToWhitelist", () => {
    it("adds email to whitelist", async () => {
      const db = makeDb({
        insert: () => ({
          values: () => ({
            returning: async () => [
              { id: "whitelist-id", roomId: "room-id", email: "a@b.com", createdAt: new Date() },
            ],
          }),
        }),
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "user-id",
              visibility: "private",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "owner" as const,
            }),
          },
          roomWhitelist: { findFirst: async () => null, findMany: async () => [] },
          roomBlacklist: { findFirst: async () => null, findMany: async () => [] },
        },
      });
      const mockDeps = {
        notifications: {
          recordNotification: async () => ({}),
          getPreferences: async () => ({
            emailEnabled: true,
            accessGrantedEmail: true,
            inviteAcceptedEmail: true,
          }),
          listNotifications: async () => ({ notifications: [], unreadCount: 0 }),
          markRead: async () => {},
          updatePreferences: async () => ({}),
        },
        lookupUserIdByEmail: async () => null,
        getUserProfile: async () => ({ email: "owner@test.com", displayName: "Owner" }),
      };
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any, mockDeps as any);
      const result = await svc.addToWhitelist("test", "user-id", "a@b.com");
      expect(result.email).toBe("a@b.com");
    });

    it("acquires an advisory lock to serialize against blacklist adds", async () => {
      let executeCalls = 0;
      const base = makeDb({
        execute: async (_q: unknown) => {
          executeCalls++;
          return undefined;
        },
        insert: () => ({
          values: () => ({
            returning: async () => [
              { id: "whitelist-id", roomId: "room-id", email: "a@b.com", createdAt: new Date() },
            ],
          }),
        }),
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "user-id",
              visibility: "private",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "owner" as const,
            }),
          },
          roomWhitelist: { findFirst: async () => null, findMany: async () => [] },
          roomBlacklist: { findFirst: async () => null, findMany: async () => [] },
        },
      });
      const mockDeps = {
        notifications: {
          recordNotification: async () => ({}),
          getPreferences: async () => ({
            emailEnabled: true,
            accessGrantedEmail: true,
            inviteAcceptedEmail: true,
          }),
          listNotifications: async () => ({ notifications: [], unreadCount: 0 }),
          markRead: async () => {},
          updatePreferences: async () => ({}),
        },
        lookupUserIdByEmail: async () => null,
        getUserProfile: async () => ({ email: "owner@test.com", displayName: "Owner" }),
      };
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(base as any, mockDeps as any);
      await svc.addToWhitelist("test", "user-id", "a@b.com");
      expect(executeCalls).toBeGreaterThan(0);
    });

    it("returns existing whitelist entry on duplicate", async () => {
      const existing = {
        id: "whitelist-id",
        roomId: "room-id",
        email: "a@b.com",
        createdAt: new Date(),
      };
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "user-id",
              visibility: "private",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "owner" as const,
            }),
          },
          roomWhitelist: {
            findFirst: async () => existing,
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.addToWhitelist("test", "user-id", "A@B.com");
      expect(result).toEqual(existing);
    });

    it("rejects non-admin/non-owner", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "member" as const,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.addToWhitelist("test", "user-id", "a@b.com")).rejects.toBeInstanceOf(
        AuthError,
      );
    });

    it("rejects self-add", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "owner" as const,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(
        svc.addToWhitelist("test", "user-id", "owner@test.com", "owner@test.com"),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe("removeFromWhitelist", () => {
    it("removes entry for admin", async () => {
      const deleted: unknown[] = [];
      const db = makeDb({
        delete: () => ({
          where: (...args: unknown[]) => ({
            returning: async () => {
              deleted.push(args);
              return [{ id: "entry-id" }];
            },
          }),
        }),
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "admin" as const,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await svc.removeFromWhitelist("test", "entry-id", "user-id");
      expect(deleted).toHaveLength(1);
    });

    it("rejects for regular member", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "member" as const,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.removeFromWhitelist("test", "entry-id", "user-id")).rejects.toBeInstanceOf(
        AuthError,
      );
    });
  });

  describe("addToBlacklist", () => {
    it("adds email to blacklist and removes from whitelist", async () => {
      const whitelistDeleted: unknown[] = [];
      const db = makeDb({
        delete: () => ({
          where: () => ({
            returning: async () => {
              whitelistDeleted.push(true);
              return [];
            },
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: async () => [
              { id: "bl-id", roomId: "room-id", email: "a@b.com", createdAt: new Date() },
            ],
          }),
        }),
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "owner" as const,
            }),
          },
          roomBlacklist: { findFirst: async () => null, findMany: async () => [] },
          roomWhitelist: { findFirst: async () => null, findMany: async () => [] },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.addToBlacklist("test", "user-id", "a@b.com");
      expect(result.email).toBe("a@b.com");
    });

    it("rejects regular member", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "member" as const,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.addToBlacklist("test", "user-id", "a@b.com")).rejects.toBeInstanceOf(
        AuthError,
      );
    });

    it("auto-kicks existing member matching blacklisted email", async () => {
      let deleteWhereCalls = 0;
      const db = makeDb({
        // Override delete so where() increments a counter and returns a resolved
        // promise (Drizzle delete queries are directly awaitable).
        delete: () => ({
          where: async () => {
            deleteWhereCalls++;
            return [];
          },
        }),
        insert: () => ({
          values: () => ({
            returning: async () => [
              { id: "bl-id", roomId: "room-id", email: "target@test.com", createdAt: new Date() },
            ],
          }),
        }),
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "owner" as const,
            }),
            // findMany is used by the auto-kick email scan
            findMany: async () => [{ userId: "target-user-id" }],
          },
          roomBlacklist: { findFirst: async () => null, findMany: async () => [] },
          roomWhitelist: { findFirst: async () => null, findMany: async () => [] },
        },
      });
      const mockDeps = {
        getUserProfile: async (id: string) => {
          if (id === "target-user-id")
            return { email: "target@test.com", displayName: "Target", avatarUrl: null };
          return { email: "owner@test.com", displayName: "Owner", avatarUrl: null };
        },
        // Reverse-lookup an email to a userId. The implementation now uses
        // this for the auto-kick path instead of iterating every member.
        lookupUserIdByEmail: async (email: string) =>
          email === "target@test.com" ? "target-user-id" : null,
      };
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any, mockDeps as any);
      await svc.addToBlacklist("test", "user-id", "target@test.com");
      // Whitelist mutual-exclusion delete + member auto-kick delete = at least 2
      expect(deleteWhereCalls).toBeGreaterThanOrEqual(2);
    });

    it("rejects self-blacklist by owner", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "owner" as const,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(
        svc.addToBlacklist("test", "user-id", "owner@test.com", "owner@test.com"),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("fails closed when admin adder and owner profile lookup fails", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "admin-id",
              role: "admin" as const,
            }),
          },
        },
      });
      const mockDeps = {
        getUserProfile: async () => null, // lookup failure / missing key
        lookupUserIdByEmail: async () => null,
      };
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any, mockDeps as any);
      await expect(svc.addToBlacklist("test", "admin-id", "victim@test.com")).rejects.toMatchObject(
        { statusCode: 503 },
      );
    });

    it("fails closed when admin adder and email reverse-lookup throws", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "admin-id",
              role: "admin" as const,
            }),
          },
        },
      });
      const mockDeps = {
        getUserProfile: async () => ({
          email: "owner@test.com",
          displayName: "Owner",
          avatarUrl: null,
        }),
        lookupUserIdByEmail: async () => {
          throw new Error("admin api down");
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any, mockDeps as any);
      await expect(svc.addToBlacklist("test", "admin-id", "victim@test.com")).rejects.toMatchObject(
        { statusCode: 503 },
      );
    });
  });

  describe("removeFromBlacklist", () => {
    it("removes entry for admin", async () => {
      const deleted: unknown[] = [];
      const db = makeDb({
        delete: () => ({
          where: () => ({
            returning: async () => {
              deleted.push(true);
              return [{ id: "entry-id" }];
            },
          }),
        }),
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "user-id",
              role: "admin" as const,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await svc.removeFromBlacklist("test", "entry-id", "user-id");
      expect(deleted).toHaveLength(1);
    });
  });

  describe("kickMember", () => {
    it("kicks member and adds to blacklist", async () => {
      let memberCalls = 0;
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const tx = {
            execute: async (_query: unknown) => undefined,
            delete: () => ({
              where: () => ({
                returning: async () => [{ id: "bl-id" }],
              }),
            }),
            insert: () => ({
              values: () => ({
                onConflictDoNothing: async () => [],
              }),
            }),
          };
          return fn(tx);
        },
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => {
              memberCalls++;
              if (memberCalls === 1)
                return { roomId: "room-id", userId: "kicker-id", role: "owner" };
              if (memberCalls === 2)
                return { roomId: "room-id", userId: "kickee-id", role: "member" };
              return null;
            },
            findMany: async () => [],
          },
        },
      });
      const mockDeps = {
        getUserProfile: async (id: string) => {
          if (id === "kickee-id") return { email: "kickee@test.com", displayName: "Kickee" };
          return { email: "owner@test.com", displayName: "Owner" };
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any, mockDeps as any);
      const result = await svc.kickMember("test", "kicker-id", "kickee-id");
      expect(result.kickeeId).toBe("kickee-id");
      expect(result.roomId).toBe("room-id");
    });

    it("rejects kicking owner", async () => {
      let memberCalls = 0;
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => {
              memberCalls++;
              if (memberCalls === 1)
                return { roomId: "room-id", userId: "kicker-id", role: "admin" };
              if (memberCalls === 2)
                return { roomId: "room-id", userId: "kickee-id", role: "owner" };
              return null;
            },
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.kickMember("test", "kicker-id", "kickee-id")).rejects.toBeInstanceOf(
        AuthError,
      );
    });

    it("rejects self-kick", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(makeDb() as any);
      await expect(svc.kickMember("test", "same-id", "same-id")).rejects.toBeInstanceOf(AppError);
    });

    it("fails the kick when the kickee email cannot be resolved", async () => {
      let memberCalls = 0;
      const db = makeDb({
        query: {
          ...makeDb().query,
          roomMembers: {
            findFirst: async () => {
              memberCalls++;
              if (memberCalls === 1)
                return { roomId: "room-id", userId: "kicker-id", role: "owner" };
              if (memberCalls === 2)
                return { roomId: "room-id", userId: "kickee-id", role: "member" };
              return null;
            },
            findMany: async () => [],
          },
        },
      });
      const mockDeps = {
        // Profile lookup fails — email cannot be resolved.
        getUserProfile: async () => null,
      };
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any, mockDeps as any);
      await expect(svc.kickMember("test", "kicker-id", "kickee-id")).rejects.toBeInstanceOf(
        AppError,
      );
    });
  });

  describe("leaveRoom", () => {
    it("removes member from room", async () => {
      const db = makeDb({
        delete: () => ({
          where: () => ({
            returning: async () => [{ roomId: "room-id" }],
          }),
        }),
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "owner-id",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "member-id",
              role: "member",
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.leaveRoom("test", "member-id");
      expect(result.roomId).toBe("room-id");
    });

    it("rejects owner trying to leave", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "owner-id",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.leaveRoom("test", "owner-id")).rejects.toBeInstanceOf(AppError);
    });
  });

  describe("transferOwnership", () => {
    it("transfers ownership and old owner becomes admin", async () => {
      // The transferOwnership tx runs two selects:
      //   1) lock-for-update on new-owner's existing rooms (returns array via `.for("update")`)
      //   2) re-fetch the updated room (returns array via direct await on the chain)
      // The stub branches on the presence of `.for` on the chain — call 1 invokes it,
      // call 2 awaits the where() result directly.
      let selectCallIndex = 0;
      const updatedRoom = {
        id: "room-id",
        slug: "test",
        ownerId: "new-owner",
        visibility: "open",
        guestAccess: "none",
        deletedAt: null,
      };
      const db = makeDb({
        transaction: async (fn: (tx: unknown) => unknown) => {
          const tx = {
            select: () => {
              const idx = selectCallIndex++;
              return {
                from: () => ({
                  where: idx === 0 ? () => ({ for: async () => [] }) : async () => [updatedRoom],
                }),
              };
            },
            update: () => ({
              set: () => ({
                where: async () => {},
              }),
            }),
            execute: async () => {},
          };
          return fn(tx);
        },
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "old-owner",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: {
            findFirst: async () => ({ roomId: "room-id", userId: "new-owner", role: "admin" }),
          },
          roomBlacklist: { findFirst: async () => null },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.transferOwnership("test", "old-owner", "new-owner");
      expect(result.roomId).toBe("room-id");
    });

    it("rejects non-owner", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "actual-owner",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.transferOwnership("test", "not-owner", "new-owner")).rejects.toBeInstanceOf(
        AuthError,
      );
    });

    it("rejects self-transfer", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(makeDb() as any);
      await expect(svc.transferOwnership("test", "owner-id", "owner-id")).rejects.toBeInstanceOf(
        AppError,
      );
    });
  });

  describe("updateMemberRole", () => {
    it("updates role from member to admin", async () => {
      const updated: unknown[] = [];
      const db = makeDb({
        update: () => ({
          set: (data: unknown) => ({
            where: () => {
              updated.push(data);
              return { returning: async () => [] };
            },
          }),
        }),
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "owner-id",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: {
            findFirst: async () => ({
              roomId: "room-id",
              userId: "target-id",
              role: "member",
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await svc.updateMemberRole("test", "owner-id", "target-id", "admin");
      expect(updated).toHaveLength(1);
      expect((updated[0] as Record<string, unknown>).role).toBe("admin");
    });

    it("rejects non-owner", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "owner-id",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(
        svc.updateMemberRole("test", "admin-id", "target-id", "admin"),
      ).rejects.toBeInstanceOf(AuthError);
    });
  });

  describe("getRoomBySlug — blacklist", () => {
    it("rejects blacklisted user", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "other-user",
              visibility: "open",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomBlacklist: {
            findFirst: async () => ({ id: "bl-id", roomId: "room-id", email: "bad@test.com" }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(svc.getRoomBySlug("test", "user-id", "bad@test.com")).rejects.toBeInstanceOf(
        AuthError,
      );
    });
  });

  describe("getRoomBySlug — private room whitelist", () => {
    it("admits whitelisted user to private room", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              ownerId: "other-user",
              visibility: "private",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomMembers: { findFirst: async () => null },
          roomWhitelist: {
            findFirst: async () => ({
              id: "wl-id",
              roomId: "room-id",
              email: "invited@test.com",
            }),
          },
          roomBlacklist: { findFirst: async () => null },
          tabs: { findMany: async () => [] },
        },
        insert: () => ({
          values: () => ({
            onConflictDoNothing: async () => [],
            returning: async () => [],
          }),
        }),
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: async () => [] }),
            where: async () => [],
          }),
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.getRoomBySlug("test", "new-user", "invited@test.com");
      expect(result.role).toBe("member");
    });
  });
});

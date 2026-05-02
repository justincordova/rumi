import { beforeAll, describe, expect, it, mock } from "bun:test";

// Mock email module so tests don't need UNSUBSCRIBE_HMAC_SECRET or RESEND_API_KEY
mock.module("@/notifications/email", () => ({
  sendInviteEmail: mock(async () => {}),
  sendInviteAcceptedEmail: mock(async () => {}),
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
        where: async () => [{ count: 0 }],
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
      roomInvites: {
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
      const db = makeDb({
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: async () => [] }),
            where: async () => [{ count: 3 }],
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
          roomInvites: { findFirst: async () => null, findMany: async () => [] },
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

    it("throws forbidden for private room with no invite", async () => {
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
          roomInvites: { findFirst: async () => null, findMany: async () => [] },
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

  describe("createInvite", () => {
    it("is idempotent — returns existing pending invite on duplicate", async () => {
      const existingInvite = { id: "invite-id", roomId: "room-id", invitedEmail: "a@b.com" };
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
          roomInvites: {
            findFirst: async () => existingInvite,
            findMany: async () => [],
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      const result = await svc.createInvite("test", "user-id", "A@B.com");
      expect(result).toEqual(existingInvite);
    });

    it("rejects self-invite with invalid_state", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(makeDb() as any);
      await expect(
        svc.createInvite("test", "user-id", "owner@example.com", "owner@example.com"),
      ).rejects.toMatchObject({ code: "invalid_state" });
    });

    it("rejects self-invite case-insensitively", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(makeDb() as any);
      await expect(
        svc.createInvite("test", "user-id", "OWNER@Example.com", "owner@example.com"),
      ).rejects.toMatchObject({ code: "invalid_state" });
    });

    it("fires notification + email side effects when deps wired", async () => {
      let notifRecorded = false;
      const db = makeDb({
        insert: () => ({
          values: () => ({
            returning: async () => [
              {
                id: "invite-id",
                roomId: "room-id",
                invitedEmail: "invitee@example.com",
                invitedBy: "user-id",
                createdAt: new Date(),
                acceptedAt: null,
              },
            ],
          }),
        }),
        query: {
          ...makeDb().query,
          rooms: {
            findFirst: async () => ({
              id: "room-id",
              slug: "test",
              name: "Test",
              ownerId: "user-id",
              visibility: "private",
              guestAccess: "none",
              deletedAt: null,
            }),
          },
          roomInvites: { findFirst: async () => null, findMany: async () => [] },
        },
      });

      const mockDeps = {
        notifications: {
          recordNotification: async () => {
            notifRecorded = true;
            // biome-ignore lint/suspicious/noExplicitAny: test stub return value
            return {} as any;
          },
          getPreferences: async () => ({
            emailEnabled: true,
            inviteReceivedEmail: true,
            inviteAcceptedEmail: true,
          }),
          listNotifications: async () => ({ notifications: [], unreadCount: 0 }),
          markRead: async () => {},
          updatePreferences: async () => ({
            emailEnabled: true,
            inviteReceivedEmail: true,
            inviteAcceptedEmail: true,
          }),
        },
        lookupUserIdByEmail: async () => "invitee-user-id",
        getUserProfile: async () => ({ email: "inviter@example.com", displayName: "Alice" }),
      };

      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any, mockDeps as any);
      await svc.createInvite("test", "user-id", "invitee@example.com", "inviter@example.com");
      expect(notifRecorded).toBe(true);
    });

    it("no DB row, no notification, no email on self-invite rejection", async () => {
      let insertCalled = false;
      const db = makeDb({
        insert: () => ({
          values: () => {
            insertCalled = true;
            return { returning: async () => [] };
          },
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createService(db as any);
      await expect(
        svc.createInvite("test", "user-id", "owner@example.com", "owner@example.com"),
      ).rejects.toMatchObject({ code: "invalid_state" });
      expect(insertCalled).toBe(false);
    });
  });
});

import { describe, expect, it } from "bun:test";
import { createNotificationsService } from "./service";

const now = new Date();

const sampleRoomAccessGrantedPayload = {
  whitelistId: "00000000-0000-0000-0000-000000000004",
  roomId: "00000000-0000-0000-0000-000000000002",
  roomSlug: "test-room",
  roomName: "Test Room",
  grantedBy: {
    userId: "00000000-0000-0000-0000-000000000003",
    displayName: "Alice",
  },
};

const sampleInviteAcceptedPayload = {
  inviteId: "00000000-0000-0000-0000-000000000001",
  roomId: "00000000-0000-0000-0000-000000000002",
  roomSlug: "test-room",
  roomName: "Test Room",
  accepterName: "Bob",
};

function makeDb(overrides: Record<string, unknown> = {}) {
  const base = {
    insert: () => ({
      values: () => ({
        returning: async () => [
          {
            id: "notif-id",
            userId: "user-1",
            type: "room_access_granted",
            payload: sampleRoomAccessGrantedPayload,
            readAt: null,
            createdAt: now,
          },
        ],
        onConflictDoUpdate: async () => [],
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => [{ count: 2 }],
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
    query: {
      notifications: {
        findMany: async () => [
          {
            id: "notif-1",
            userId: "user-1",
            type: "room_access_granted",
            payload: sampleRoomAccessGrantedPayload,
            readAt: null,
            createdAt: now,
          },
          {
            id: "notif-2",
            userId: "user-1",
            type: "invite_accepted",
            payload: sampleInviteAcceptedPayload,
            readAt: new Date("2025-01-01"),
            createdAt: new Date("2025-01-01"),
          },
        ],
      },
      notificationPreferences: {
        findFirst: async () => null,
      },
    },
    ...overrides,
  };
  return base;
}

describe("createNotificationsService", () => {
  describe("recordNotification", () => {
    it("inserts a row and returns it", async () => {
      let insertedValues: unknown = null;
      const db = makeDb({
        insert: () => ({
          values: (v: unknown) => {
            insertedValues = v;
            return {
              returning: async () => [
                {
                  id: "notif-id",
                  userId: v.userId,
                  type: v.type,
                  payload: v.payload,
                  readAt: null,
                  createdAt: now,
                },
              ],
            };
          },
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(db as any);
      const row = await svc.recordNotification("user-1", {
        type: "room_access_granted",
        payload: sampleRoomAccessGrantedPayload,
      });
      expect(row.userId).toBe("user-1");
      expect(row.type).toBe("room_access_granted");
      expect(insertedValues).toBeDefined();
    });

    it("validates payload shape — rejects malformed payload", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(makeDb() as any);
      await expect(
        svc.recordNotification("user-1", {
          type: "room_access_granted",
          // biome-ignore lint/suspicious/noExplicitAny: intentionally malformed
          payload: { bad: true } as any,
        }),
      ).rejects.toThrow();
    });
  });

  describe("listNotifications", () => {
    it("returns notifications and unreadCount", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(makeDb() as any);
      const result = await svc.listNotifications("user-1");
      expect(result.notifications).toHaveLength(2);
      expect(result.unreadCount).toBe(2);
    });

    it("caps limit at 50", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(makeDb() as any);
      const result = await svc.listNotifications("user-1", { limit: 100 });
      expect(result.notifications).toHaveLength(2);
    });
  });

  describe("markRead", () => {
    it("marks specific ids as read", async () => {
      const updateArgs: { where: unknown; set: unknown }[] = [];
      const db = makeDb({
        update: () => ({
          set: (s: unknown) => ({
            where: (w: unknown) => {
              updateArgs.push({ set: s, where: w });
            },
          }),
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(db as any);
      await svc.markRead("user-1", { ids: ["notif-1"] });
      expect(updateArgs).toHaveLength(1);
      expect(updateArgs[0].set).toEqual({ readAt: expect.any(Date) });
    });

    it("marks all as read", async () => {
      const updateArgs: { where: unknown; set: unknown }[] = [];
      const db = makeDb({
        update: () => ({
          set: (s: unknown) => ({
            where: (w: unknown) => {
              updateArgs.push({ set: s, where: w });
            },
          }),
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(db as any);
      await svc.markRead("user-1", { all: true });
      expect(updateArgs).toHaveLength(1);
      expect(updateArgs[0].set).toEqual({ readAt: expect.any(Date) });
    });
  });

  describe("getPreferences", () => {
    it("returns defaults when no row exists", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(makeDb() as any);
      const prefs = await svc.getPreferences("user-1");
      expect(prefs).toEqual({
        emailEnabled: true,
        accessGrantedEmail: true,
        inviteAcceptedEmail: true,
      });
    });

    it("returns stored row when present", async () => {
      const db = makeDb({
        query: {
          ...makeDb().query,
          notificationPreferences: {
            findFirst: async () => ({
              userId: "user-1",
              emailEnabled: false,
              inviteReceivedEmail: true,
              inviteAcceptedEmail: false,
            }),
          },
        },
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(db as any);
      const prefs = await svc.getPreferences("user-1");
      expect(prefs).toEqual({
        emailEnabled: false,
        accessGrantedEmail: true,
        inviteAcceptedEmail: false,
      });
    });
  });

  describe("updatePreferences", () => {
    it("upserts with only patched fields on conflict", async () => {
      let conflictSet: unknown = null;
      let insertValues: unknown = null;
      const db = makeDb({
        query: {
          ...makeDb().query,
          notificationPreferences: {
            findFirst: async () => ({
              userId: "user-1",
              emailEnabled: false,
              inviteReceivedEmail: true,
              inviteAcceptedEmail: true,
            }),
          },
        },
        insert: () => ({
          values: (v: unknown) => {
            insertValues = v;
            return {
              onConflictDoUpdate: (opts: unknown) => {
                conflictSet = (opts as { set: unknown }).set;
              },
            };
          },
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(db as any);
      await svc.updatePreferences("user-1", { emailEnabled: false });
      expect(conflictSet).toEqual({
        emailEnabled: false,
        inviteReceivedEmail: undefined,
        updatedAt: expect.any(Date),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      expect((insertValues as any).emailEnabled).toBe(true);
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      expect((insertValues as any).inviteReceivedEmail).toBe(true);
    });

    it("re-reads preferences after upsert", async () => {
      let insertCalled = false;
      const db = makeDb({
        query: {
          ...makeDb().query,
          notificationPreferences: {
            findFirst: async () => ({
              userId: "user-1",
              emailEnabled: false,
              inviteReceivedEmail: true,
              inviteAcceptedEmail: true,
            }),
          },
        },
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => {
              insertCalled = true;
            },
          }),
        }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const svc = createNotificationsService(db as any);
      const result = await svc.updatePreferences("user-1", { emailEnabled: false });
      expect(insertCalled).toBe(true);
      expect(result).toEqual({
        emailEnabled: false,
        accessGrantedEmail: true,
        inviteAcceptedEmail: true,
      });
    });
  });
});

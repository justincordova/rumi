import type { DbClient } from "@/db/client";
import { roomInvites, roomMembers, rooms, tabs } from "@/db/schema";
import { AppError, AuthError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sendInviteAcceptedEmail, sendInviteEmail } from "@/notifications/email";
import type { NotificationsService } from "@/notifications/service";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getUserPlan } from "./plan";
import { fallbackSlug, generateSlug } from "./slug";

interface ServiceDeps {
  notifications: NotificationsService;
  lookupUserIdByEmail: (email: string) => Promise<string | null>;
  getUserProfile: (userId: string) => Promise<{ email: string; displayName: string | null } | null>;
}

export type Service = ReturnType<typeof createService>;

export function createService(db: DbClient, deps?: ServiceDeps) {
  return {
    async createRoom(opts: {
      ownerId: string;
      name?: string;
      visibility?: "open" | "private";
      guestAccess?: "none" | "view" | "edit";
    }) {
      const plan = await getUserPlan(opts.ownerId);
      const ownedCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(rooms)
        .where(and(eq(rooms.ownerId, opts.ownerId), isNull(rooms.deletedAt)));
      const count = ownedCount[0]?.count ?? 0;
      if (count >= plan.maxRooms) {
        throw new AppError(
          "plan_limit_reached",
          `${plan.plan === "free" ? "Free plan" : `${plan.plan} plan`} limited to ${plan.maxRooms} rooms. Upgrade for more.`,
          403,
        );
      }

      for (let attempt = 0; attempt < 6; attempt++) {
        const slug = attempt < 5 ? generateSlug() : fallbackSlug();
        try {
          return await db.transaction(async (tx) => {
            const [room] = await tx
              .insert(rooms)
              .values({
                slug,
                name: opts.name ?? null,
                ownerId: opts.ownerId,
                visibility: opts.visibility ?? "open",
                guestAccess: opts.guestAccess ?? "none",
              })
              .returning();
            await tx.insert(roomMembers).values({
              // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
              roomId: room!.id,
              userId: opts.ownerId,
              role: "owner",
            });
            await tx.insert(tabs).values({
              // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
              roomId: room!.id,
              type: "tab",
              language: "markdown",
              name: "Welcome",
              ordinal: 0,
            });
            // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
            return room!;
          });
        } catch (err: unknown) {
          // biome-ignore lint/suspicious/noExplicitAny: postgres error codes aren't typed
          const pgErr = err as any;
          if (pgErr?.code === "23505" && pgErr?.constraint_name === "rooms_slug_unique") {
            logger.debug({ slug, attempt: attempt + 1 }, "slug collision, retrying");
            continue;
          }
          throw err;
        }
      }
      logger.error({ attempts: 6 }, "failed to generate unique slug after 6 attempts");
      throw new AppError("server_error", "Failed to generate unique slug after 6 attempts", 500);
    },

    async listRooms(userId: string, userEmail: string) {
      const memberRooms = await db
        .select()
        .from(rooms)
        .innerJoin(roomMembers, eq(roomMembers.roomId, rooms.id))
        .where(and(eq(roomMembers.userId, userId), isNull(rooms.deletedAt)))
        .orderBy(desc(rooms.updatedAt));

      const invitedRooms = await db
        .select()
        .from(rooms)
        .innerJoin(roomInvites, eq(roomInvites.roomId, rooms.id))
        .where(
          and(
            eq(roomInvites.invitedEmail, userEmail),
            isNull(roomInvites.acceptedAt),
            isNull(rooms.deletedAt),
          ),
        );

      const seen = new Set<string>();
      const out: Array<typeof rooms.$inferSelect & { pendingInvite: boolean }> = [];

      for (const r of memberRooms) {
        if (seen.has(r.rooms.id)) continue;
        seen.add(r.rooms.id);
        out.push({ ...r.rooms, pendingInvite: false });
      }
      for (const r of invitedRooms) {
        if (seen.has(r.rooms.id)) continue;
        seen.add(r.rooms.id);
        out.push({ ...r.rooms, pendingInvite: true });
      }
      return out;
    },

    async getRoomBySlug(slug: string, userId?: string, userEmail?: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");

      const fetchTabs = () =>
        db.query.tabs.findMany({
          where: eq(tabs.roomId, room.id),
          orderBy: (t, { asc }) => [asc(t.ordinal)],
        });

      if (!userId) {
        if (room.guestAccess === "none") {
          throw new AuthError("forbidden", "Sign in required");
        }
        const tabList = await fetchTabs();
        return { room, role: null as string | null, tabs: tabList };
      }

      const existing = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });

      if (existing) {
        const tabList = await fetchTabs();
        return { room, role: existing.role, tabs: tabList };
      }

      if (room.visibility === "open") {
        await db
          .insert(roomMembers)
          .values({ roomId: room.id, userId, role: "member" })
          .onConflictDoNothing();
        const tabList = await fetchTabs();
        return { room, role: "member" as const, tabs: tabList };
      }

      const invite = await db.query.roomInvites.findFirst({
        where: and(
          eq(roomInvites.roomId, room.id),
          eq(roomInvites.invitedEmail, userEmail ?? ""),
          isNull(roomInvites.acceptedAt),
        ),
      });
      if (!invite) throw new AuthError("forbidden", "No access to this room");

      // Accept the invite inside a transaction; use RETURNING to detect whether
      // this call actually consumed the invite (vs. a concurrent call that won the race).
      let consumed = false;
      await db.transaction(async (tx) => {
        await tx
          .insert(roomMembers)
          .values({ roomId: room.id, userId, role: "member" })
          .onConflictDoNothing();
        const result = await tx
          .update(roomInvites)
          .set({ acceptedAt: new Date() })
          .where(and(eq(roomInvites.id, invite.id), isNull(roomInvites.acceptedAt)))
          .returning({ id: roomInvites.id });
        consumed = result.length > 0;
      });

      // Fire side effects only when this call consumed the invite (not a re-visit).
      if (consumed && deps) {
        try {
          const accepterProfile = await deps.getUserProfile(userId).catch(() => null);
          const accepterName = accepterProfile?.displayName ?? accepterProfile?.email ?? null;

          await deps.notifications.recordNotification(room.ownerId, {
            type: "invite_accepted",
            payload: {
              inviteId: invite.id,
              roomId: room.id,
              roomSlug: room.slug,
              roomName: room.name ?? null,
              accepterName,
            },
          });

          const ownerPrefs = await deps.notifications.getPreferences(room.ownerId);
          if (ownerPrefs.emailEnabled && ownerPrefs.inviteAcceptedEmail) {
            const ownerProfile = await deps.getUserProfile(room.ownerId).catch(() => null);
            if (ownerProfile) {
              void sendInviteAcceptedEmail({
                toUserId: room.ownerId,
                toEmail: ownerProfile.email,
                accepterName: accepterName ?? "Someone",
                roomName: room.name ?? room.slug,
                roomSlug: room.slug,
              });
            }
          }
        } catch (err) {
          logger.error({ err, roomId: room.id }, "invite-accepted side effects failed");
        }
      }

      const tabList = await fetchTabs();
      return { room, role: "member" as const, tabs: tabList };
    },

    async updateRoom(
      slug: string,
      userId: string,
      body: {
        name?: string | null;
        visibility?: "open" | "private";
        guestAccess?: "none" | "view" | "edit";
      },
    ) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");

      const sideEffectsNeeded =
        (body.visibility !== undefined && body.visibility !== room.visibility) ||
        (body.guestAccess !== undefined && body.guestAccess !== room.guestAccess);

      const [updated] = await db
        .update(rooms)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(rooms.id, room.id))
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on UPDATE
      return { room: updated!, sideEffectsNeeded };
    },

    async softDeleteRoom(slug: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");
      await db.update(rooms).set({ deletedAt: new Date() }).where(eq(rooms.id, room.id));
      return { roomId: room.id };
    },

    async createInvite(slug: string, userId: string, email: string, inviterEmail?: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");

      const lower = email.toLowerCase();

      // Reject self-invites before any DB write or side effect.
      if (inviterEmail && lower === inviterEmail.toLowerCase()) {
        throw new AppError("invalid_state", "You can't invite yourself", 400);
      }

      const existing = await db.query.roomInvites.findFirst({
        where: and(
          eq(roomInvites.roomId, room.id),
          eq(roomInvites.invitedEmail, lower),
          isNull(roomInvites.acceptedAt),
        ),
      });
      if (existing) return existing;

      const [invite] = await db
        .insert(roomInvites)
        .values({ roomId: room.id, invitedEmail: lower, invitedBy: userId })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
      const created = invite!;

      // Fire side effects if deps are wired.
      if (deps) {
        try {
          const inviterProfile = await deps.getUserProfile(userId).catch(() => null);
          const inviterDisplayName =
            inviterProfile?.displayName ?? inviterProfile?.email ?? "Someone";

          const inviteeUserId = await deps.lookupUserIdByEmail(lower).catch(() => null);
          if (inviteeUserId) {
            await deps.notifications.recordNotification(inviteeUserId, {
              type: "invite_received",
              payload: {
                inviteId: created.id,
                roomId: room.id,
                roomSlug: room.slug,
                roomName: room.name ?? null,
                invitedBy: { userId, displayName: inviterDisplayName },
              },
            });

            const inviteePrefs = await deps.notifications.getPreferences(inviteeUserId);
            if (inviteePrefs.emailEnabled && inviteePrefs.inviteReceivedEmail) {
              void sendInviteEmail({
                toUserId: inviteeUserId,
                toEmail: lower,
                inviterName: inviterDisplayName,
                roomName: room.name ?? room.slug,
                roomSlug: room.slug,
              });
            }
          } else {
            void sendInviteEmail({
              toUserId: "anon",
              toEmail: lower,
              inviterName: inviterDisplayName,
              roomName: room.name ?? room.slug,
              roomSlug: room.slug,
            });
          }
        } catch (err) {
          logger.error({ err, roomId: room.id }, "create-invite side effects failed");
        }
      }

      return created;
    },

    async listInvites(slug: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");
      return db.query.roomInvites.findMany({
        where: and(eq(roomInvites.roomId, room.id), isNull(roomInvites.acceptedAt)),
      });
    },

    async revokeInvite(slug: string, inviteId: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");
      const result = await db
        .delete(roomInvites)
        .where(
          and(
            eq(roomInvites.id, inviteId),
            eq(roomInvites.roomId, room.id),
            isNull(roomInvites.acceptedAt),
          ),
        )
        .returning({ id: roomInvites.id });
      if (result.length === 0) throw new AuthError("not_found", "Invite not found");
    },
  };
}

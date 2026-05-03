import type { DbClient } from "@/db/client";
import { roomBlacklist, roomMembers, roomWhitelist, rooms, tabs } from "@/db/schema";
import { AppError, AuthError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sendAccessGrantedEmail } from "@/notifications/email";
import type { NotificationsService } from "@/notifications/service";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getUserPlan } from "./plan";
import { fallbackSlug, generateSlug } from "./slug";

interface ServiceDeps {
  notifications: NotificationsService;
  lookupUserIdByEmail: (email: string) => Promise<string | null>;
  getUserProfile: (
    userId: string,
  ) => Promise<{ email: string; displayName: string | null; avatarUrl: string | null } | null>;
}

export type Service = ReturnType<typeof createService>;

async function findExistingMemberByEmail(
  db: DbClient,
  roomId: string,
  currentUserId: string,
  email: string | undefined,
  deps?: ServiceDeps,
): Promise<{ role: string } | null> {
  if (!email || !deps) return null;
  const members = await db.query.roomMembers.findMany({
    where: and(eq(roomMembers.roomId, roomId), sql`${roomMembers.userId} != ${currentUserId}`),
    columns: { userId: true, role: true },
  });
  for (const m of members) {
    const profile = await deps.getUserProfile(m.userId).catch(() => null);
    if (profile?.email?.toLowerCase() === email.toLowerCase()) {
      return { role: m.role };
    }
  }
  return null;
}

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

      const whitelistedRooms = await db
        .select()
        .from(rooms)
        .innerJoin(roomWhitelist, eq(roomWhitelist.roomId, rooms.id))
        .where(
          and(sql`lower(${roomWhitelist.email}) = lower(${userEmail})`, isNull(rooms.deletedAt)),
        );

      const seen = new Set<string>();
      const out: Array<
        typeof rooms.$inferSelect & { pendingAccess: boolean; pendingWhitelistId?: string }
      > = [];

      for (const r of memberRooms) {
        if (seen.has(r.rooms.id)) continue;
        seen.add(r.rooms.id);
        out.push({ ...r.rooms, pendingAccess: false });
      }
      for (const r of whitelistedRooms) {
        if (seen.has(r.rooms.id)) continue;
        seen.add(r.rooms.id);
        out.push({ ...r.rooms, pendingAccess: true, pendingWhitelistId: r.room_whitelist.id });
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

      // Check blacklist
      const blacklisted = await db.query.roomBlacklist.findFirst({
        where: and(
          eq(roomBlacklist.roomId, room.id),
          sql`lower(${roomBlacklist.email}) = lower(${userEmail ?? ""})`,
        ),
      });
      if (blacklisted) throw new AuthError("forbidden", "Access denied");

      const existing = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });

      if (existing) {
        const tabList = await fetchTabs();
        return { room, role: existing.role, tabs: tabList };
      }

      if (room.visibility === "open") {
        const existingByEmail = await findExistingMemberByEmail(
          db,
          room.id,
          userId,
          userEmail,
          deps,
        );
        if (existingByEmail) {
          const tabList = await fetchTabs();
          return { room, role: existingByEmail.role, tabs: tabList };
        }
        await db
          .insert(roomMembers)
          .values({ roomId: room.id, userId, role: "member" })
          .onConflictDoNothing();
        const tabList = await fetchTabs();
        return { room, role: "member" as const, tabs: tabList };
      }

      // Private room — check whitelist
      const whitelisted = await db.query.roomWhitelist.findFirst({
        where: and(
          eq(roomWhitelist.roomId, room.id),
          sql`lower(${roomWhitelist.email}) = lower(${userEmail ?? ""})`,
        ),
      });
      if (!whitelisted) throw new AuthError("forbidden", "No access to this room");

      await db
        .insert(roomMembers)
        .values({ roomId: room.id, userId, role: "member" })
        .onConflictDoNothing();

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
        .set({
          ...body,
          ...(body.visibility === "private" ? { guestAccess: "none" } : {}),
          updatedAt: new Date(),
        })
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

    async listTrashedRooms(userId: string) {
      return db
        .select()
        .from(rooms)
        .where(and(eq(rooms.ownerId, userId), sql`${rooms.deletedAt} IS NOT NULL`))
        .orderBy(desc(rooms.deletedAt));
    },

    async restoreRoom(slug: string, userId: string) {
      return db.transaction(async (tx) => {
        const rows = await tx.select().from(rooms).where(eq(rooms.slug, slug)).for("update");
        const row = rows[0];
        if (!row) throw new AuthError("not_found", "Room not found");
        if (row.ownerId !== userId) throw new AuthError("forbidden", "Owner only");
        if (!row.deletedAt) {
          throw new AppError("invalid_state", "Room is not in trash", 400);
        }

        const plan = await getUserPlan(userId);
        const ownedCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(rooms)
          .where(and(eq(rooms.ownerId, userId), isNull(rooms.deletedAt)));
        const count = ownedCount[0]?.count ?? 0;
        if (count >= plan.maxRooms) {
          throw new AppError(
            "plan_limit_reached",
            `Restoring would exceed your plan's room limit of ${plan.maxRooms}. Upgrade or hard-delete other rooms first.`,
            403,
          );
        }

        const [updated] = await tx
          .update(rooms)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(rooms.id, row.id))
          .returning();
        // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on UPDATE
        return updated!;
      });
    },

    async addToWhitelist(slug: string, userId: string, email: string, adderEmail?: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");

      const adder = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!adder || (adder.role !== "owner" && adder.role !== "admin")) {
        throw new AuthError("forbidden", "Only owners or admins can add to whitelist");
      }

      const lower = email.toLowerCase();

      if (adderEmail && lower === adderEmail.toLowerCase()) {
        throw new AppError("invalid_state", "You can't add yourself", 400);
      }

      // Remove from blacklist if present (mutual exclusion)
      await db
        .delete(roomBlacklist)
        .where(
          and(
            eq(roomBlacklist.roomId, room.id),
            sql`lower(${roomBlacklist.email}) = lower(${lower})`,
          ),
        );

      const existing = await db.query.roomWhitelist.findFirst({
        where: and(
          eq(roomWhitelist.roomId, room.id),
          sql`lower(${roomWhitelist.email}) = lower(${lower})`,
        ),
      });
      if (existing) return existing;

      const [entry] = await db
        .insert(roomWhitelist)
        .values({ roomId: room.id, email: lower })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
      const created = entry!;

      if (deps) {
        try {
          const adderProfile = await deps.getUserProfile(userId).catch(() => null);
          const adderDisplayName = adderProfile?.displayName ?? adderProfile?.email ?? "Someone";

          const inviteeUserId = await deps.lookupUserIdByEmail(lower).catch(() => null);
          if (inviteeUserId) {
            await deps.notifications.recordNotification(inviteeUserId, {
              type: "room_access_granted",
              payload: {
                whitelistId: created.id,
                roomId: room.id,
                roomSlug: room.slug,
                roomName: room.name ?? null,
                grantedBy: { userId, displayName: adderDisplayName },
              },
            });

            const inviteePrefs = await deps.notifications.getPreferences(inviteeUserId);
            if (inviteePrefs.emailEnabled && inviteePrefs.accessGrantedEmail) {
              void sendAccessGrantedEmail({
                toUserId: inviteeUserId,
                toEmail: lower,
                granterName: adderDisplayName,
                roomName: room.name ?? room.slug,
                roomSlug: room.slug,
              });
            }
          } else {
            void sendAccessGrantedEmail({
              toUserId: "anon",
              toEmail: lower,
              granterName: adderDisplayName,
              roomName: room.name ?? room.slug,
              roomSlug: room.slug,
            });
          }
        } catch (err) {
          logger.error({ err, roomId: room.id }, "add-to-whitelist side effects failed");
        }
      }

      return created;
    },

    async listWhitelist(slug: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      const viewer = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!viewer || (viewer.role !== "owner" && viewer.role !== "admin")) {
        throw new AuthError("forbidden", "Only owners or admins can view whitelist");
      }
      return db.query.roomWhitelist.findMany({
        where: eq(roomWhitelist.roomId, room.id),
      });
    },

    async removeFromWhitelist(slug: string, entryId: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      const viewer = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!viewer || (viewer.role !== "owner" && viewer.role !== "admin")) {
        throw new AuthError("forbidden", "Only owners or admins can remove from whitelist");
      }
      const result = await db
        .delete(roomWhitelist)
        .where(and(eq(roomWhitelist.id, entryId), eq(roomWhitelist.roomId, room.id)))
        .returning({ id: roomWhitelist.id });
      if (result.length === 0) throw new AuthError("not_found", "Whitelist entry not found");
    },

    async addToBlacklist(slug: string, userId: string, email: string, adderEmail?: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");

      const adder = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!adder || adder.role === "member") {
        throw new AuthError("forbidden", "Only owners or admins can blacklist");
      }

      const lower = email.toLowerCase();

      if (adder.role === "owner") {
        if (adderEmail && lower === adderEmail.toLowerCase()) {
          throw new AppError("invalid_state", "You can't blacklist yourself", 400);
        }
      }

      // Check if trying to blacklist the owner
      if (adder.role === "admin") {
        // Admins can't blacklist owners
        const ownerProfile = deps
          ? await deps.getUserProfile(room.ownerId).catch(() => null)
          : null;
        if (ownerProfile && ownerProfile.email.toLowerCase() === lower) {
          throw new AuthError("forbidden", "Cannot blacklist the room owner");
        }
      }

      // Remove from whitelist if present (mutual exclusion)
      await db
        .delete(roomWhitelist)
        .where(
          and(
            eq(roomWhitelist.roomId, room.id),
            sql`lower(${roomWhitelist.email}) = lower(${lower})`,
          ),
        );

      // Auto-kick if currently a member
      if (deps) {
        const allMembers = await db.query.roomMembers.findMany({
          where: eq(roomMembers.roomId, room.id),
          columns: { userId: true },
        });
        for (const m of allMembers) {
          const profile = await deps.getUserProfile(m.userId).catch(() => null);
          if (profile?.email?.toLowerCase() === lower) {
            await db
              .delete(roomMembers)
              .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, m.userId)));
            break;
          }
        }
      }

      const existing = await db.query.roomBlacklist.findFirst({
        where: and(
          eq(roomBlacklist.roomId, room.id),
          sql`lower(${roomBlacklist.email}) = lower(${lower})`,
        ),
      });
      if (existing) return existing;

      const [entry] = await db
        .insert(roomBlacklist)
        .values({ roomId: room.id, email: lower })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
      return entry!;
    },

    async listBlacklist(slug: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      const viewer = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!viewer || (viewer.role !== "owner" && viewer.role !== "admin")) {
        throw new AuthError("forbidden", "Only owners or admins can view blacklist");
      }
      return db.query.roomBlacklist.findMany({
        where: eq(roomBlacklist.roomId, room.id),
      });
    },

    async removeFromBlacklist(slug: string, entryId: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      const viewer = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!viewer || (viewer.role !== "owner" && viewer.role !== "admin")) {
        throw new AuthError("forbidden", "Only owners or admins can remove from blacklist");
      }
      const result = await db
        .delete(roomBlacklist)
        .where(and(eq(roomBlacklist.id, entryId), eq(roomBlacklist.roomId, room.id)))
        .returning({ id: roomBlacklist.id });
      if (result.length === 0) throw new AuthError("not_found", "Blacklist entry not found");
    },

    async listMembers(slug: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      const viewer = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!viewer) throw new AuthError("forbidden", "Not a member");

      const members = await db.query.roomMembers.findMany({
        where: eq(roomMembers.roomId, room.id),
      });

      const roleRank: Record<string, number> = { owner: 3, admin: 2, member: 1 };
      const enriched = await Promise.all(
        members.map(async (m) => {
          const profile = deps ? await deps.getUserProfile(m.userId).catch(() => null) : null;
          return {
            userId: m.userId,
            role: m.role,
            displayName: profile?.displayName ?? null,
            email: profile?.email ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            joinedAt: m.joinedAt,
          };
        }),
      );
      const byEmail = new Map<string, (typeof enriched)[number]>();
      for (const m of enriched) {
        const key = m.email?.toLowerCase();
        if (!key) {
          byEmail.set(m.userId, m);
          continue;
        }
        const existing = byEmail.get(key);
        if (!existing || (roleRank[m.role] ?? 0) > (roleRank[existing.role] ?? 0)) {
          byEmail.set(key, m);
        }
      }
      return [...byEmail.values()];
    },

    async kickMember(slug: string, kickerId: string, kickeeId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");

      if (kickerId === kickeeId) {
        throw new AppError("invalid_state", "Use 'leave' to remove yourself", 400);
      }

      const kicker = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, kickerId)),
      });
      if (!kicker) throw new AuthError("forbidden", "Not a member");
      const kickee = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, kickeeId)),
      });
      if (!kickee) throw new AuthError("not_found", "Member not found");

      if (kickee.role === "owner") {
        throw new AuthError("forbidden", "Cannot kick the owner");
      }
      if (kicker.role === "member") {
        throw new AuthError("forbidden", "Only owners or admins can kick");
      }
      if (kicker.role === "admin" && kickee.role !== "member") {
        throw new AuthError("forbidden", "Admins cannot kick other admins or owners");
      }

      // Get kickee email for blacklist
      let kickeeEmail: string | null = null;
      if (deps) {
        const profile = await deps.getUserProfile(kickeeId).catch(() => null);
        kickeeEmail = profile?.email?.toLowerCase() ?? null;
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(roomMembers)
          .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, kickeeId)));

        // Add to blacklist
        if (kickeeEmail) {
          await tx
            .insert(roomBlacklist)
            .values({ roomId: room.id, email: kickeeEmail })
            .onConflictDoNothing();
          // Remove from whitelist if present
          await tx
            .delete(roomWhitelist)
            .where(
              and(
                eq(roomWhitelist.roomId, room.id),
                sql`lower(${roomWhitelist.email}) = lower(${kickeeEmail})`,
              ),
            );
        }
      });

      return { roomId: room.id, kickeeId };
    },

    async leaveRoom(slug: string, userId: string) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId === userId) {
        throw new AppError("invalid_state", "Owners must transfer ownership before leaving", 400);
      }
      const member = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
      });
      if (!member) throw new AuthError("not_found", "Not a member");
      await db
        .delete(roomMembers)
        .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)));
      return { roomId: room.id };
    },

    async transferOwnership(slug: string, currentOwnerId: string, newOwnerId: string) {
      if (currentOwnerId === newOwnerId) {
        throw new AppError("invalid_state", "Already the owner", 400);
      }
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId !== currentOwnerId) throw new AuthError("forbidden", "Owner only");

      const target = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, newOwnerId)),
      });
      if (!target) {
        throw new AuthError("forbidden", "New owner must be a current member");
      }

      // Check if new owner is blacklisted
      if (deps) {
        const newOwnerProfile = await deps.getUserProfile(newOwnerId).catch(() => null);
        if (newOwnerProfile) {
          const blacklisted = await db.query.roomBlacklist.findFirst({
            where: and(
              eq(roomBlacklist.roomId, room.id),
              sql`lower(${roomBlacklist.email}) = lower(${newOwnerProfile.email})`,
            ),
          });
          if (blacklisted) {
            throw new AppError(
              "invalid_state",
              "Cannot transfer ownership to a blacklisted user. Remove them from the blacklist first.",
              400,
            );
          }
        }
      }

      const updated = await db.transaction(async (tx) => {
        const newOwnerPlan = await getUserPlan(newOwnerId);
        const newOwnerOwnedCount = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(rooms)
          .where(and(eq(rooms.ownerId, newOwnerId), isNull(rooms.deletedAt)));
        const ownedByNewOwner = newOwnerOwnedCount[0]?.count ?? 0;
        if (ownedByNewOwner >= newOwnerPlan.maxRooms) {
          throw new AppError(
            "plan_limit_reached",
            `New owner is at their plan's room limit (${newOwnerPlan.maxRooms}). They must upgrade or remove a room first.`,
            403,
          );
        }

        await tx.update(rooms).set({ ownerId: newOwnerId }).where(eq(rooms.id, room.id));
        await tx.execute(sql`
          UPDATE ${roomMembers}
          SET role = CASE
            WHEN user_id = ${currentOwnerId} THEN 'admin'
            WHEN user_id = ${newOwnerId} THEN 'owner'
            ELSE role
          END
          WHERE room_id = ${room.id} AND user_id IN (${currentOwnerId}, ${newOwnerId})
        `);
        const [next] = await tx.select().from(rooms).where(eq(rooms.id, room.id));
        return next;
      });
      // biome-ignore lint/style/noNonNullAssertion: returning row guaranteed
      return { room: updated!, roomId: room.id };
    },

    async updateMemberRole(
      slug: string,
      ownerId: string,
      targetUserId: string,
      role: "admin" | "member",
    ) {
      const room = await db.query.rooms.findFirst({
        where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
      });
      if (!room) throw new AuthError("not_found", "Room not found");
      if (room.ownerId !== ownerId) {
        throw new AuthError("forbidden", "Owner only");
      }
      if (targetUserId === ownerId) {
        throw new AppError(
          "invalid_state",
          "Owners cannot change their own role; transfer ownership first",
          400,
        );
      }
      const target = await db.query.roomMembers.findFirst({
        where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, targetUserId)),
      });
      if (!target) throw new AuthError("not_found", "Member not found");
      if (target.role === "owner") {
        throw new AppError("invalid_state", "Cannot change owner role directly", 400);
      }

      await db
        .update(roomMembers)
        .set({ role })
        .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, targetUserId)));
      return { roomId: room.id };
    },
  };
}

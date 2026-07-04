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
  // Single email→userId admin lookup, then a single DB membership query.
  // Replaces N+1 per-member profile fetches that would ramp linearly with
  // room size on every getRoomBySlug call.
  const candidate = await deps.lookupUserIdByEmail(email).catch(() => null);
  if (!candidate || candidate === currentUserId) return null;
  const member = await db.query.roomMembers.findFirst({
    where: and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, candidate)),
    columns: { role: true },
  });
  return member ? { role: member.role } : null;
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

      for (let attempt = 0; attempt < 6; attempt++) {
        const slug = attempt < 5 ? generateSlug() : fallbackSlug();
        try {
          return await db.transaction(async (tx) => {
            // Lock the user's existing rooms BEFORE counting so two
            // concurrent createRoom calls can't both observe `count = N-1`,
            // both pass the check, and both insert. Without this, a user
            // can race past their plan's maxRooms cap.
            const ownedRows = await tx
              .select({ id: rooms.id })
              .from(rooms)
              .where(and(eq(rooms.ownerId, opts.ownerId), isNull(rooms.deletedAt)))
              .for("update");
            if (ownedRows.length >= plan.maxRooms) {
              throw new AppError(
                "plan_limit_reached",
                `${plan.plan === "free" ? "Free plan" : `${plan.plan} plan`} limited to ${plan.maxRooms} rooms. Upgrade for more.`,
                403,
              );
            }

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
        // Re-check blacklist inside a tx so a concurrent admin add-to-blacklist
        // between our earlier check and the insert can't leave the user with a
        // member row in a room they're blacklisted from. Without this, future
        // requests deny them via blacklist but the row persists and they keep
        // counting against concurrent-user caps + showing in member lists.
        await db.transaction(async (tx) => {
          const stillBlacklisted = await tx.query.roomBlacklist.findFirst({
            where: and(
              eq(roomBlacklist.roomId, room.id),
              sql`lower(${roomBlacklist.email}) = lower(${userEmail ?? ""})`,
            ),
          });
          if (stillBlacklisted) throw new AuthError("forbidden", "Access denied");
          await tx
            .insert(roomMembers)
            .values({ roomId: room.id, userId, role: "member" })
            .onConflictDoNothing();
        });
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

      // Same blacklist-race protection as the open branch above.
      await db.transaction(async (tx) => {
        const stillBlacklisted = await tx.query.roomBlacklist.findFirst({
          where: and(
            eq(roomBlacklist.roomId, room.id),
            sql`lower(${roomBlacklist.email}) = lower(${userEmail ?? ""})`,
          ),
        });
        if (stillBlacklisted) throw new AuthError("forbidden", "Access denied");
        await tx
          .insert(roomMembers)
          .values({ roomId: room.id, userId, role: "member" })
          .onConflictDoNothing();
      });

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

      // Compute the final visibility *after* this patch — even if visibility
      // isn't being changed in this patch, the room may already be private,
      // and a guestAccess change must be rejected/coerced accordingly. The
      // previous code only forced guestAccess='none' when visibility was
      // being explicitly set to private in the same patch.
      const finalVisibility = body.visibility ?? room.visibility;

      const [updated] = await db
        .update(rooms)
        .set({
          ...body,
          ...(finalVisibility === "private" ? { guestAccess: "none" } : {}),
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
        // Lock the user's existing rooms so a concurrent createRoom (which
        // also acquires this lock) can't sneak under the cap while we
        // restore. The single-room lock at line 306 only protects against
        // double-restore of THIS room — it doesn't see other rooms.
        const ownedRows = await tx
          .select({ id: rooms.id })
          .from(rooms)
          .where(and(eq(rooms.ownerId, userId), isNull(rooms.deletedAt)))
          .for("update");
        if (ownedRows.length >= plan.maxRooms) {
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

      // Mutate state in a single transaction so a crash mid-flow can't
      // leave the email on both lists. Side-effects (notifications,
      // emails) run after commit.
      // `wasNew` is false when an existing whitelist row is reused so we
      // don't re-spam the invitee on every admin click.
      const { entry: created, wasNew } = await db.transaction(async (tx) => {
        // Serialize against the inverse mutation (addToBlacklist / kickMember)
        // for the same room+email. Both writers delete-from-one-list then
        // insert-into-the-other in opposite orders; under READ COMMITTED they
        // can interleave so neither delete sees the other's uncommitted insert,
        // leaving the email on BOTH lists (which silently denies access since
        // the blacklist wins everywhere). A transaction-scoped advisory lock
        // keyed on room+email forces them to run in series.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${room.id}:${lower}`}, 0))`,
        );

        // Remove from blacklist if present (mutual exclusion)
        await tx
          .delete(roomBlacklist)
          .where(
            and(
              eq(roomBlacklist.roomId, room.id),
              sql`lower(${roomBlacklist.email}) = lower(${lower})`,
            ),
          );

        const existingRow = await tx.query.roomWhitelist.findFirst({
          where: and(
            eq(roomWhitelist.roomId, room.id),
            sql`lower(${roomWhitelist.email}) = lower(${lower})`,
          ),
        });
        if (existingRow) return { entry: existingRow, wasNew: false };

        const [inserted] = await tx
          .insert(roomWhitelist)
          .values({ roomId: room.id, email: lower })
          .returning();
        // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
        return { entry: inserted!, wasNew: true };
      });

      // Skip notifications + email when the row already existed — admins
      // re-clicking "Add to whitelist" must not re-spam the invitee.
      if (deps && wasNew) {
        try {
          const adderProfile = await deps.getUserProfile(userId).catch(() => null);
          const adderDisplayName = adderProfile?.displayName ?? adderProfile?.email ?? "Someone";

          const inviteeUserId = await deps.lookupUserIdByEmail(lower).catch(() => null);
          // If the invitee is already a current member of the room (e.g.
          // open-room auto-join already happened, or admin re-added someone
          // they previously kicked), skip the "you have access" notification
          // and email — those messages would be misleading.
          let alreadyMember = false;
          if (inviteeUserId) {
            const existing = await db.query.roomMembers.findFirst({
              where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, inviteeUserId)),
              columns: { userId: true },
            });
            alreadyMember = !!existing;
          }

          if (inviteeUserId && !alreadyMember) {
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
              // Catch the async rejection so a transient Resend failure
              // doesn't surface as UnhandledPromiseRejection. The send()
              // helper already logs errors internally; this is defense in
              // depth.
              sendAccessGrantedEmail({
                toUserId: inviteeUserId,
                toEmail: lower,
                granterName: adderDisplayName,
                roomName: room.name ?? room.slug,
                roomSlug: room.slug,
              }).catch((err) =>
                logger.error({ err, roomId: room.id }, "access-granted email failed"),
              );
            }
          } else if (!inviteeUserId) {
            // Email-only invite (no Rumi account yet) — send the email so
            // the invitee can sign up and land in the room.
            sendAccessGrantedEmail({
              toUserId: "anon",
              toEmail: lower,
              granterName: adderDisplayName,
              roomName: room.name ?? room.slug,
              roomSlug: room.slug,
            }).catch((err) =>
              logger.error({ err, roomId: room.id }, "access-granted email failed (anon)"),
            );
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

      // Check if trying to blacklist the owner. This is a security guard, so
      // it must fail CLOSED: if the owner's profile can't be resolved while
      // an admin is the actor, reject the request instead of proceeding —
      // otherwise a transient admin-API failure lets an admin blacklist the
      // owner's email and lock them out of their own room (blacklist is
      // checked before membership everywhere). Mirrors kickMember's 503.
      if (adder.role === "admin" && deps) {
        const ownerProfile = await deps.getUserProfile(room.ownerId).catch(() => null);
        if (!ownerProfile) {
          throw new AppError(
            "server_error",
            "Could not verify the target of this blacklist entry — try again",
            503,
          );
        }
        if (ownerProfile.email.toLowerCase() === lower) {
          throw new AuthError("forbidden", "Cannot blacklist the room owner");
        }
      }

      // Resolve member-to-kick (if any) before opening the tx. Use the
      // email→userId reverse lookup (single Supabase admin call) instead of
      // iterating every room member and looking up their profile (N+1 calls
      // that would burn through the Supabase admin rate limit on a 50-member
      // Max-plan room).
      let kickeeUserId: string | null = null;
      if (deps) {
        let candidate: string | null;
        try {
          candidate = await deps.lookupUserIdByEmail(lower);
        } catch (err) {
          // Admins rely on this lookup for the peer-admin guard below — fail
          // closed for them. Owners have full authority over every member, so
          // a failed lookup only skips the auto-kick; the blacklist entry
          // itself still locks the target out on next auth.
          if (adder.role === "admin") {
            logger.warn({ err, roomId: room.id }, "blacklist target lookup failed");
            throw new AppError(
              "server_error",
              "Could not verify the target of this blacklist entry — try again",
              503,
            );
          }
          candidate = null;
        }
        if (candidate) {
          const target = await db.query.roomMembers.findFirst({
            where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, candidate)),
            columns: { userId: true, role: true },
          });
          if (target) {
            // Blacklisting auto-kicks the matching member. An admin must not be
            // able to use blacklist as a back door to remove a peer admin or
            // the owner — that would bypass the role guard in `kickMember`.
            if (adder.role === "admin" && target.role !== "member") {
              throw new AuthError("forbidden", "Admins cannot blacklist other admins or the owner");
            }
            kickeeUserId = candidate;
          }
        }
      }

      // All mutations in one tx so a crash mid-flow can't leave the user
      // on the whitelist, in room_members, AND off the blacklist.
      return await db.transaction(async (tx) => {
        // Serialize against addToWhitelist for the same room+email so the two
        // delete-then-insert flows can't interleave and leave the email on
        // both lists (see the matching lock in addToWhitelist).
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${room.id}:${lower}`}, 0))`,
        );

        // Remove from whitelist if present (mutual exclusion)
        await tx
          .delete(roomWhitelist)
          .where(
            and(
              eq(roomWhitelist.roomId, room.id),
              sql`lower(${roomWhitelist.email}) = lower(${lower})`,
            ),
          );

        // Auto-kick the matching member, if any.
        if (kickeeUserId) {
          await tx
            .delete(roomMembers)
            .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, kickeeUserId)));
        }

        const existing = await tx.query.roomBlacklist.findFirst({
          where: and(
            eq(roomBlacklist.roomId, room.id),
            sql`lower(${roomBlacklist.email}) = lower(${lower})`,
          ),
        });
        if (existing) return existing;

        const [entry] = await tx
          .insert(roomBlacklist)
          .values({ roomId: room.id, email: lower })
          .returning();
        // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() guarantees a row on INSERT
        return entry!;
      });
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

      // Get kickee email for blacklist. The kick MUST blacklist the kickee
      // (documented invariant: "Kick auto-blacklists"). If the profile/email
      // lookup fails, performing a "soft kick" that only removes the member
      // row lets the kicked user immediately rejoin an open room (or stay
      // whitelisted in a private one). So when deps are wired but the email
      // can't be resolved, fail the kick so the client can retry rather than
      // silently leaving the ban incomplete.
      let kickeeEmail: string | null = null;
      if (deps) {
        const profile = await deps.getUserProfile(kickeeId).catch(() => null);
        kickeeEmail = profile?.email?.toLowerCase() ?? null;
        if (!kickeeEmail) {
          throw new AppError(
            "server_error",
            "Could not resolve member email to complete kick",
            503,
          );
        }
      }

      await db.transaction(async (tx) => {
        // Serialize the blacklist/whitelist mutation against addToWhitelist for
        // the same room+email (same advisory-lock key) so a concurrent
        // whitelist add can't interleave and leave the email on both lists.
        if (kickeeEmail) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${room.id}:${kickeeEmail}`}, 0))`,
          );
        }

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
        // Lock the new owner's existing room rows so a concurrent createRoom
        // by them can't sneak under the cap during transfer. SELECT FOR UPDATE
        // is acceptable here since transfer is a rare admin action.
        const newOwnerRows = await tx
          .select({ id: rooms.id })
          .from(rooms)
          .where(and(eq(rooms.ownerId, newOwnerId), isNull(rooms.deletedAt)))
          .for("update");
        const ownedByNewOwner = newOwnerRows.length;
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

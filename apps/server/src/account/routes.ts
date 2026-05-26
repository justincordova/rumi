import { deleteUser, updateUserMetadata } from "@/auth/supabase-admin";
import { getStripe, isStripeConfigured } from "@/billing/stripe";
import { db } from "@/db/client";
import {
  notificationPreferences,
  notifications,
  roomMembers,
  rooms,
  subscriptions,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { UpdateAccountBody } from "@rumi/protocol";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

export const accountRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /** Update profile fields (display name). */
  typed.patch("/", { schema: { body: UpdateAccountBody } }, async (req) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const userId = req.user!.id;
    const ok = await updateUserMetadata(userId, {
      display_name: req.body.displayName,
      // Mirror to other common keys so any downstream consumer sees the new name.
      full_name: req.body.displayName,
      name: req.body.displayName,
    });
    if (!ok) {
      throw new AppError("supabase_admin_unavailable", "Could not update profile right now", 503);
    }
    return { user: { id: userId, displayName: req.body.displayName } };
  });

  /**
   * Delete the user's account.
   *
   * - Rooms the user solely owns (no other members) are soft-deleted; the
   *   purge scheduler hard-deletes them after 30 days.
   * - Rooms the user owns with co-members block the deletion until ownership
   *   is transferred. Returns 409 with a list of blocking rooms.
   * - Removes the user from all rooms they're a non-owner member of.
   * - Wipes notification preferences and notifications.
   * - Calls Supabase admin API to schedule the user record's deletion.
   */
  app.delete("/", async (req, reply) => {
    // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user is set for /api/ routes
    const userId = req.user!.id;

    const ownedRooms = await db.query.rooms.findMany({
      where: and(eq(rooms.ownerId, userId), isNull(rooms.deletedAt)),
      columns: { id: true, slug: true, name: true },
    });

    // Identify which owned rooms have other members (blocking) vs. solo
    // (safe to soft-delete).
    const blockingRooms: Array<{ slug: string; name: string | null }> = [];
    const soloRooms: Array<{ id: string; slug: string }> = [];
    for (const room of ownedRooms) {
      const otherMemberCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, room.id), sql`${roomMembers.userId} != ${userId}`));
      const others = otherMemberCount[0]?.count ?? 0;
      if (others > 0) {
        blockingRooms.push({ slug: room.slug, name: room.name });
      } else {
        soloRooms.push({ id: room.id, slug: room.slug });
      }
    }

    if (blockingRooms.length > 0) {
      return reply.code(409).send({
        error: {
          code: "ownership_transfer_required",
          message: `Transfer ownership of ${blockingRooms.length} ${
            blockingRooms.length === 1 ? "room" : "rooms"
          } before deleting your account.`,
          rooms: blockingRooms,
        },
      });
    }

    // Best-effort: cancel the user's Stripe subscription BEFORE wiping the
    // local row. Without this, the user is gone from our DB but Stripe keeps
    // billing them until period end — and every subsequent renewal webhook
    // fires for a userId that no longer maps to a Supabase account.
    const subRow = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });
    if (isStripeConfigured() && subRow?.stripeSubscriptionId) {
      try {
        await getStripe().subscriptions.cancel(subRow.stripeSubscriptionId);
      } catch (err) {
        // Don't block the account deletion on a Stripe failure — operator
        // intervention can clean up the stranded subscription, but the user
        // expects their deletion to succeed.
        logger.warn(
          { err, userId, subscriptionId: subRow.stripeSubscriptionId },
          "stripe subscription cancel failed during account delete; manual cleanup may be required",
        );
      }
    }

    await db.transaction(async (tx) => {
      const now = new Date();
      // Soft-delete every solo-owned room.
      for (const room of soloRooms) {
        await tx
          .update(rooms)
          .set({ deletedAt: now })
          .where(and(eq(rooms.id, room.id), isNull(rooms.deletedAt)));
      }
      // Remove all room_members rows for this user (any leftover non-owner
      // memberships in rooms they're not solely owning).
      await tx.delete(roomMembers).where(eq(roomMembers.userId, userId));
      // Wipe billing row to stop any future webhook from matching this user.
      await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
      // Hard-delete notifications + prefs (they're per-user and ephemeral).
      await tx.delete(notifications).where(eq(notifications.userId, userId));
      await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    });

    // Drop any active WS connections for this user.
    app.dropUserConnections(userId);

    // Best-effort: schedule the supabase user record deletion. If the admin
    // API call fails (no service role key, transient error), the DB cleanup
    // above is still done and the next sign-in will fail anyway because
    // there's no row to authenticate against.
    const removed = await deleteUser(userId);
    if (!removed) {
      logger.warn(
        { userId },
        "supabase user delete returned non-ok or service role key missing; relying on DB cleanup",
      );
    }

    logger.info(
      { userId, soloRoomCount: soloRooms.length },
      "account deleted (rooms soft-deleted; purge scheduler will hard-delete after 30 days)",
    );

    return reply.code(200).send({ signedOut: true });
  });
};

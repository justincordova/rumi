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
import { env } from "@/lib/env";
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

    // Single query: identify which owned rooms have other members (blocking)
    // vs. solo (safe to soft-delete). Previous version ran one COUNT(*) per
    // owned room — N+1 against the user's owned-room list. Max plan owns up
    // to 50 rooms, so this collapses 51 round-trips to 1.
    const roomsWithOtherCounts = await db
      .select({
        id: rooms.id,
        slug: rooms.slug,
        name: rooms.name,
        otherCount: sql<number>`count(${roomMembers.userId}) filter (where ${roomMembers.userId} != ${userId})::int`,
      })
      .from(rooms)
      .leftJoin(roomMembers, eq(roomMembers.roomId, rooms.id))
      .where(and(eq(rooms.ownerId, userId), isNull(rooms.deletedAt)))
      .groupBy(rooms.id, rooms.slug, rooms.name);

    const blockingRooms: Array<{ slug: string; name: string | null }> = [];
    const soloRooms: Array<{ id: string; slug: string }> = [];
    for (const r of roomsWithOtherCounts) {
      if (r.otherCount > 0) {
        blockingRooms.push({ slug: r.slug, name: r.name });
      } else {
        soloRooms.push({ id: r.id, slug: r.slug });
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

    // Delete the Supabase user record. This is NOT best-effort: auth is
    // JWKS-based (`verifyJwt`), so no local DB row is consulted at sign-in —
    // if the identity survives, the user can keep signing in and using the
    // app even though we just told them their account was deleted, and their
    // PII stays in Supabase with no retry mechanism. When the admin API is
    // configured but the delete fails, surface the failure so the client can
    // retry; the local cleanup above is idempotent (solo rooms are already
    // soft-deleted and excluded from the re-run's blocking check).
    const removed = await deleteUser(userId);
    if (!removed) {
      if (env.SUPABASE_SERVICE_ROLE_KEY) {
        logger.error({ userId }, "supabase user delete failed after local cleanup");
        throw new AppError(
          "account_delete_incomplete",
          "Your data was removed but your sign-in identity could not be deleted. Please try again.",
          502,
        );
      }
      // Dev stub: no service-role key configured — identity deletion is not
      // possible locally; proceed so the flow is testable.
      logger.warn({ userId }, "service role key missing; supabase identity not deleted (dev)");
    }

    logger.info(
      { userId, soloRoomCount: soloRooms.length },
      "account deleted (rooms soft-deleted; purge scheduler will hard-delete after 30 days)",
    );

    return reply.code(200).send({ signedOut: true });
  });
};

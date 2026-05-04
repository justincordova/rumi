import { db } from "@/db/client";
import { processedWebhookEvents, subscriptions } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { eq, lte } from "drizzle-orm";
import type Stripe from "stripe";
import { type Interval, type PaidPlan, planToPriceId, priceIdToPlan } from "./plans";
import { getStripe } from "./stripe";

export type BillingService = ReturnType<typeof createBillingService>;

function mapStripeStatus(status: Stripe.Subscription.Status): "active" | "past_due" | "canceled" {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    default:
      return "canceled";
  }
}

async function resolveSubscriptionFromEvent(
  event: Stripe.Event,
): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!session.subscription) return null;
    return stripe.subscriptions.retrieve(session.subscription as string);
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    return event.data.object as Stripe.Subscription;
  }
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    // In Stripe SDK v22 (API dahlia), subscription info is nested under invoice.parent.subscription_details
    const subRef = invoice.parent?.subscription_details?.subscription;
    if (!subRef) {
      // The nested path is correct for Stripe SDK v22; surfacing this lets us
      // detect SDK drift early. If you see this log after upgrading the SDK,
      // re-check the invoice→subscription path.
      logger.warn({ eventId: event.id }, "invoice.paid: subscription path not found, skipping");
      return null;
    }
    const subId = typeof subRef === "string" ? subRef : subRef.id;
    return stripe.subscriptions.retrieve(subId);
  }
  return null;
}

export function createBillingService() {
  return {
    async findOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
      return db.transaction(async (tx) => {
        // Lock the row for this user so concurrent upgrade clicks don't both
        // pass the null-check and create two Stripe customers.
        const [existing] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId))
          .for("update");

        if (existing?.stripeCustomerId) return existing.stripeCustomerId;

        const stripe = getStripe();
        const customer = await stripe.customers.create({
          email,
          metadata: { userId },
        });

        if (existing) {
          await tx
            .update(subscriptions)
            .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
            .where(eq(subscriptions.userId, userId));
        } else {
          await tx.insert(subscriptions).values({
            userId,
            plan: "free",
            status: "active",
            stripeCustomerId: customer.id,
          });
        }
        return customer.id;
      });
    },

    async createEmbeddedCheckoutSession(opts: {
      userId: string;
      email: string;
      plan: PaidPlan;
      interval: Interval;
    }): Promise<{ clientSecret: string }> {
      const priceId = planToPriceId(opts.plan, opts.interval);
      if (!priceId) {
        throw new AppError("stripe_not_configured", "Plan price IDs not configured", 503);
      }

      const customerId = await this.findOrCreateStripeCustomer(opts.userId, opts.email);
      const stripe = getStripe();

      const session = await stripe.checkout.sessions.create({
        ui_mode: "embedded_page",
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: opts.userId,
        subscription_data: { metadata: { userId: opts.userId } },
        automatic_tax: { enabled: env.NODE_ENV === "production" },
        tax_id_collection: { enabled: env.NODE_ENV === "production" },
        return_url: `${env.WEB_URL}/settings?tab=billing&checkout=success`,
      });

      if (!session.client_secret)
        throw new AppError("server_error", "Stripe did not return a client secret", 500);
      return { clientSecret: session.client_secret };
    },

    async createPortalSession(opts: { userId: string }): Promise<{ url: string }> {
      const row = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, opts.userId),
      });
      if (!row?.stripeCustomerId) {
        throw new AppError("no_stripe_customer", "No billing account found", 404);
      }
      const stripe = getStripe();
      const portal = await stripe.billingPortal.sessions.create({
        customer: row.stripeCustomerId,
        return_url: `${env.WEB_URL}/settings?tab=billing`,
      });
      return { url: portal.url };
    },

    async upsertSubscriptionFromEvent(
      event: Stripe.Event,
    ): Promise<{ planChanged: boolean; userId: string | null }> {
      return db.transaction(async (tx) => {
        // Acquire idempotency lock by inserting first — Postgres serializes
        // concurrent insertions of the same primary key. The losing tx gets
        // an empty `returning` and bails before doing any work, so two
        // concurrent webhook deliveries (Stripe retries during deploys, or
        // two replicas) can't both run the upsert in parallel and clobber
        // ordering. Using `findFirst → ... → insert` instead leaves a
        // phantom-read window under READ COMMITTED.
        const claimed = await tx
          .insert(processedWebhookEvents)
          .values({ eventId: event.id, eventType: event.type })
          .onConflictDoNothing()
          .returning({ eventId: processedWebhookEvents.eventId });
        if (claimed.length === 0) {
          return { planChanged: false, userId: null };
        }

        const sub = await resolveSubscriptionFromEvent(event);
        if (!sub) {
          return { planChanged: false, userId: null };
        }

        // Resolve userId from subscription metadata, fallback to customer lookup.
        // Cross-validate the two: Stripe metadata is set by us in
        // `subscription_data.metadata`, but is editable in the Stripe Portal.
        // If metadata claims user A but the customer-id maps to user B in
        // our DB, prefer B (whoever owns the Stripe customer in our records)
        // and log a warning. This blocks "spoofed metadata" from granting a
        // plan to the wrong user.
        const metaUserId = sub.metadata?.userId ?? null;
        const byCustomer = await tx.query.subscriptions.findFirst({
          where: eq(subscriptions.stripeCustomerId, sub.customer as string),
        });
        const dbUserId = byCustomer?.userId ?? null;
        const userId: string | null = dbUserId ?? metaUserId;
        if (metaUserId && dbUserId && metaUserId !== dbUserId) {
          logger.warn(
            { eventId: event.id, metaUserId, dbUserId, customer: sub.customer },
            "webhook: subscription metadata userId disagrees with stored customer mapping; trusting db",
          );
        }

        if (!userId) {
          logger.warn(
            { eventId: event.id, customer: sub.customer },
            "webhook: cannot resolve userId",
          );
          return { planChanged: false, userId: null };
        }

        const priceId = sub.items.data[0]?.price.id ?? null;
        const planInfo = priceId ? priceIdToPlan(priceId) : null;
        if (priceId && !planInfo) {
          logger.error(
            { priceId, eventId: event.id, userId, subscriptionId: sub.id },
            "webhook: unknown price ID, preserving existing plan",
          );
        }
        const before = await tx.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, userId),
        });

        // current_period_end moved to subscription items in Stripe SDK v22+
        const periodEndSec = sub.items.data[0]?.current_period_end ?? null;
        const isDeleted = event.type === "customer.subscription.deleted";

        // Out-of-order protection: if the row is already canceled and the
        // incoming event is for the same (now-deleted) subscription, ignore
        // it. Stripe doesn't guarantee event order — a late `updated` after
        // `deleted` would otherwise resurrect the row with active state.
        const isLateUpdateForCanceledSub =
          !isDeleted &&
          before?.status === "canceled" &&
          before?.stripeSubscriptionId === null &&
          // Only suppress if the event references a subscription that's
          // already in a terminal state. An `updated` event with status=active
          // for a *new* subscription should still go through.
          (sub.status === "canceled" || sub.status === "incomplete_expired");

        if (isLateUpdateForCanceledSub) {
          logger.info(
            { eventId: event.id, userId, subscriptionId: sub.id },
            "ignoring late update for canceled subscription",
          );
          return { planChanged: false, userId };
        }

        // On `customer.subscription.deleted`, leave `plan` and
        // `currentPeriodEnd` intact — `resolvePlan` keeps paid access alive
        // while `cancelAtPeriodEnd && periodValid`, then naturally falls back
        // to free once the period elapses. Setting plan='free' here would
        // strip access the moment Stripe fires the event (e.g. immediate
        // admin cancel), even though the user paid through period end.
        const next = {
          userId,
          plan: isDeleted
            ? ((before?.plan ?? "free") as "free" | "pro" | "max")
            : ((planInfo?.plan ?? before?.plan ?? "free") as "free" | "pro" | "max"),
          status: mapStripeStatus(sub.status),
          cancelAtPeriodEnd: isDeleted ? true : (sub.cancel_at_period_end ?? false),
          currentPeriodEnd: periodEndSec
            ? new Date(periodEndSec * 1000)
            : (before?.currentPeriodEnd ?? null),
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          stripeCustomerId: sub.customer as string,
          stripeSubscriptionId: isDeleted ? null : sub.id,
          updatedAt: new Date(),
        };

        if (!isDeleted && !planInfo && !before) {
          logger.error(
            { eventId: event.id, userId, priceId, subscriptionId: sub.id },
            "webhook: cannot resolve plan for new subscription, skipping upsert",
          );
          return { planChanged: false, userId };
        }

        await tx
          .insert(subscriptions)
          .values({ ...next, createdAt: new Date() })
          .onConflictDoUpdate({
            target: subscriptions.userId,
            set: { ...next },
          });

        // Prune processed events older than 30 days to keep the table bounded
        // while still tolerating Stripe's max retry window. Done inside the
        // tx since it's a small, indexed delete and avoids extra round-trips.
        const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
        await tx
          .delete(processedWebhookEvents)
          .where(lte(processedWebhookEvents.processedAt, cutoff));

        // `planChanged` drives the connection-drop side effect. On `deleted`
        // we don't change `plan` immediately — the actual downgrade happens
        // later when `currentPeriodEnd` passes, which a future event (or
        // `getUserPlan` evaluation) will reflect. So no drop here.
        const planChanged = before?.plan !== next.plan;
        return { planChanged, userId };
      });
    },
  };
}

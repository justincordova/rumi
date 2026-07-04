import { db } from "@/db/client";
import { processedWebhookEvents, subscriptions } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { eq, lte, sql } from "drizzle-orm";
import Stripe from "stripe";
import { type Interval, type PaidPlan, planToPriceId, priceIdToPlan } from "./plans";
import { getStripe } from "./stripe";

/**
 * Wraps a Stripe SDK call and re-throws known SDK errors as `AppError`s with
 * the right status code. Without this, transient SDK errors (network blip,
 * Stripe rate-limit, mis-configured key) all surface as `500` and get
 * Sentry-tagged as unhandled — drowning real bugs in noise and giving the
 * client a useless message.
 */
async function callStripe<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Stripe.errors.StripeRateLimitError) {
      throw new AppError("stripe_rate_limited", "Billing is busy, try again shortly", 429);
    }
    if (err instanceof Stripe.errors.StripeConnectionError) {
      throw new AppError("stripe_unavailable", "Billing temporarily unavailable", 503);
    }
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
      logger.error({ err, label }, "stripe auth failed — check STRIPE_SECRET_KEY");
      throw new AppError("stripe_misconfigured", "Billing misconfigured", 503);
    }
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
      throw new AppError("stripe_resource_missing", "Billing record not found", 404);
    }
    throw err;
  }
}

export type BillingService = ReturnType<typeof createBillingService>;

function mapStripeStatus(status: Stripe.Subscription.Status): "active" | "past_due" | "canceled" {
  switch (status) {
    case "active":
    case "trialing":
    // `paused` (set via pause_collection in the Billing Portal) preserves
    // access through the current period — collapsing to "canceled" would
    // strip paid features immediately. Treat as active here; `resolvePlan`
    // handles the period-end downgrade naturally.
    case "paused":
      return "active";
    // `unpaid` and `incomplete` indicate transient failure (dunning,
    // pending 3DS). Map to past_due so we keep the row and let the next
    // event flip it back. Treating them as canceled would strip access on
    // a brief SCA challenge during signup.
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
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
    return callStripe("subscriptions.retrieve", () =>
      stripe.subscriptions.retrieve(session.subscription as string),
    );
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
    return callStripe("subscriptions.retrieve", () => stripe.subscriptions.retrieve(subId));
  }
  return null;
}

export function createBillingService() {
  return {
    async findOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
      return db.transaction(async (tx) => {
        // Serialize concurrent calls for the same user. A row lock (FOR UPDATE)
        // is insufficient on the first-upgrade path: no subscriptions row exists
        // yet, so FOR UPDATE locks nothing and two concurrent checkout clicks
        // would each create a Stripe customer (leaking an orphaned one) and then
        // race on INSERT. A transaction-scoped advisory lock serializes even
        // when there is no row to lock, and releases automatically on commit.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

        const [existing] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId))
          .for("update");

        if (existing?.stripeCustomerId) return existing.stripeCustomerId;

        const stripe = getStripe();
        const customer = await callStripe("customers.create", () =>
          stripe.customers.create({
            email,
            metadata: { userId },
          }),
        );

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

      const session = await callStripe("checkout.sessions.create", () =>
        stripe.checkout.sessions.create({
          ui_mode: "embedded_page",
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: priceId, quantity: 1 }],
          client_reference_id: opts.userId,
          subscription_data: { metadata: { userId: opts.userId } },
          automatic_tax: { enabled: env.NODE_ENV === "production" },
          tax_id_collection: { enabled: env.NODE_ENV === "production" },
          return_url: `${env.WEB_URL}/settings?tab=billing&checkout=success`,
        }),
      );

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
      const portal = await callStripe("billingPortal.sessions.create", () =>
        stripe.billingPortal.sessions.create({
          customer: row.stripeCustomerId as string,
          return_url: `${env.WEB_URL}/settings?tab=billing`,
        }),
      );
      return { url: portal.url };
    },

    async upsertSubscriptionFromEvent(
      event: Stripe.Event,
    ): Promise<{ planChanged: boolean; userId: string | null }> {
      // Resolve the subscription BEFORE opening the transaction. For
      // `checkout.session.completed` and `invoice.paid` this performs a
      // Stripe network round-trip; doing it inside the tx pins one of the
      // few pooled connections for the full duration of Stripe latency —
      // a handful of concurrent webhook deliveries during a Stripe slowdown
      // would starve every other DB query in the process (room routes, WS
      // auth). The event-id idempotency claim below still protects against
      // duplicate work; worst case a duplicate delivery costs one redundant
      // Stripe read before bailing at the claim.
      const sub = await resolveSubscriptionFromEvent(event);
      if (!sub) {
        // Nothing to record for this event, but still claim the event id so
        // retries of a no-op event short-circuit.
        await db
          .insert(processedWebhookEvents)
          .values({ eventId: event.id, eventType: event.type })
          .onConflictDoNothing();
        return { planChanged: false, userId: null };
      }

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

        // Serialize all webhook upserts for the same Stripe customer. The
        // per-event-id idempotency claim above only stops the *same* event
        // from running twice — it does nothing for two *different* events for
        // the same customer (e.g. `customer.subscription.updated` and
        // `invoice.paid` delivered together, or a retry overlapping a fresh
        // delivery). Without this lock both transactions read `before`
        // independently and race on `onConflictDoUpdate` (last-writer-wins),
        // which can also defeat the out-of-order guard below since the late
        // event may have snapshotted `before` before the other committed.
        // A transaction-scoped advisory lock on the customer id (same pattern
        // as findOrCreateStripeCustomer) forces them to run in series.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${sub.customer as string}, 0))`,
        );

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

        // A deletion event for a customer we have no row for: either the
        // account was deleted (row wiped by account/routes.ts) or the
        // subscription never belonged to this app. Recreating a canceled row
        // from the metadata fallback would resurrect billing state for a
        // nonexistent user — skip.
        if (!dbUserId && event.type === "customer.subscription.deleted") {
          logger.info(
            { eventId: event.id, customer: sub.customer },
            "webhook: deletion for unknown customer, skipping",
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

        // `planChanged` drives the connection-drop side effect at the
        // webhook layer. On `customer.subscription.deleted` we deliberately
        // don't flip the stored `plan` field — `resolvePlan` keeps paid
        // access alive while `cancelAtPeriodEnd && periodValid`, then falls
        // back to free naturally. So `planChanged` will be false on delete,
        // and the webhook handler in `webhook.ts` explicitly drops on
        // `isDeleted` regardless so the next connection re-evaluates limits.
        const planChanged = before?.plan !== next.plan;
        return { planChanged, userId };
      });
    },
  };
}

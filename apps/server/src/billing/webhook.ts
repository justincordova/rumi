import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { FastifyPluginAsync } from "fastify";
import type Stripe from "stripe";
import { createBillingService } from "./service";
import { getStripe, isStripeConfigured } from "./stripe";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // invoice.paid fires on every successful renewal; used to flip past_due → active
  // and refresh current_period_end after dunning recovery.
  "invoice.paid",
]);

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Override JSON parsing for this plugin scope only — Stripe signature
  // verification requires the raw bytes, not a parsed object.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  const service = createBillingService();

  // Webhook is exempted from the global rate limit. Stripe sends from a known
  // IP range; under heavy event bursts (replays after an outage, bulk Portal
  // actions) the global 200/min cap is reachable from a single IP and would
  // cause Stripe retries we'd rather not generate.
  app.post("/webhook", { config: { rateLimit: false } }, async (req, reply) => {
    if (!isStripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
      logger.error(
        "webhook received but Stripe is not configured — paid subscriptions will not be recorded",
      );
      // 503 in production so Stripe retries (and we get pager noise) instead
      // of silently dropping. In dev/test we return 200 to keep local Stripe
      // CLI runs noise-free.
      if (env.NODE_ENV === "production") {
        return reply.code(503).send({ error: "stripe_not_configured" });
      }
      return reply.code(200).send({ received: true, ignored: true });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      throw new AppError("webhook_signature_invalid", "Missing Stripe-Signature header", 400);
    }

    let event: Stripe.Event;
    try {
      event = await getStripe().webhooks.constructEventAsync(
        req.body as Buffer,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      logger.warn({ err }, "webhook signature verification failed");
      // 400 — Stripe does not retry signature failures
      return reply.code(400).send({ error: "invalid_signature" });
    }

    if (!HANDLED_EVENTS.has(event.type)) {
      return reply.code(200).send({ received: true, ignored: true });
    }

    try {
      const result = await service.upsertSubscriptionFromEvent(event);
      if (result.userId) {
        const isDeleted = event.type === "customer.subscription.deleted";
        if (result.planChanged || isDeleted) {
          app.dropUserConnections(result.userId);
        }
      }
      return reply.code(200).send({ received: true });
    } catch (err) {
      logger.error({ err, eventId: event.id }, "webhook handler failed");
      // 500 so Stripe retries — the transaction in the service ensures partial
      // failure rolls back, so a retry will see the unprocessed event.
      return reply.code(500).send({ error: "handler_failed" });
    }
  });
};

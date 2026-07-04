import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError("stripe_not_configured", "Billing is not configured", 503);
  }
  if (!_stripe) {
    // Pinning the API version protects us from silent payload-shape changes
    // when the Stripe SDK upgrades. Update this in lockstep with the SDK
    // major version + verify webhook events still parse against the new shape.
    // Explicit timeout: the SDK default is 80s, and some Stripe calls run
    // while a pooled DB connection is held (findOrCreateStripeCustomer's
    // advisory-lock tx) — a hung Stripe request must not pin a connection
    // from the small pool for over a minute.
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
      timeout: 15_000,
      maxNetworkRetries: 1,
    });
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

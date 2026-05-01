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
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-04-22.dahlia" });
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

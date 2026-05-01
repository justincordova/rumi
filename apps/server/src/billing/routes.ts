import { AppError } from "@/lib/errors";
import { CheckoutBody } from "@rumi/protocol";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createBillingService } from "./service";
import { isStripeConfigured } from "./stripe";

const stripeGuard = (configured: boolean) => {
  if (!configured) throw new AppError("stripe_not_configured", "Billing not configured", 503);
};

export const billingRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const service = createBillingService();

  typed.post(
    "/checkout/embedded",
    {
      schema: {
        body: CheckoutBody,
        response: { 200: z.object({ clientSecret: z.string() }) },
      },
    },
    async (req) => {
      stripeGuard(isStripeConfigured());
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user
      const { id, email } = req.user!;
      return service.createEmbeddedCheckoutSession({
        userId: id,
        email,
        plan: req.body.plan,
        interval: req.body.interval,
      });
    },
  );

  typed.post(
    "/portal",
    {
      schema: {
        response: { 200: z.object({ url: z.string() }) },
      },
    },
    async (req) => {
      stripeGuard(isStripeConfigured());
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user
      return service.createPortalSession({ userId: req.user!.id });
    },
  );
};

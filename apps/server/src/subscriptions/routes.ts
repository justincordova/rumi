import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { GetSubscriptionResponse } from "@rumi/protocol";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/me",
    {
      schema: {
        response: { 200: GetSubscriptionResponse },
      },
    },
    async (req) => {
      const row = await db.query.subscriptions.findFirst({
        // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user
        where: eq(subscriptions.userId, req.user!.id),
      });
      if (!row) {
        return { subscription: null };
      }
      return {
        subscription: {
          plan: row.plan,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd?.toISOString(),
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        },
      };
    },
  );
};

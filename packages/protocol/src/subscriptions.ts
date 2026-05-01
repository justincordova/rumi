import { z } from "zod";

export const PlanType = z.enum(["free", "pro", "max"]);
export type PlanType = z.infer<typeof PlanType>;

export const SubscriptionStatus = z.enum(["active", "past_due", "canceled"]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const Subscription = z.object({
  plan: PlanType,
  status: SubscriptionStatus,
  currentPeriodEnd: z.string().datetime().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});
export type Subscription = z.infer<typeof Subscription>;

export const GetSubscriptionResponse = z.object({
  subscription: Subscription.nullable(),
});
export type GetSubscriptionResponse = z.infer<typeof GetSubscriptionResponse>;

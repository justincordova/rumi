import { env } from "@/lib/env";

export type Interval = "monthly" | "yearly";
export type PaidPlan = "pro" | "max";

interface PlanInfo {
  plan: PaidPlan;
  interval: Interval;
}

export function priceIdToPlan(priceId: string): PlanInfo | null {
  switch (priceId) {
    case env.STRIPE_PRICE_PRO_MONTHLY:
      return { plan: "pro", interval: "monthly" };
    case env.STRIPE_PRICE_PRO_YEARLY:
      return { plan: "pro", interval: "yearly" };
    case env.STRIPE_PRICE_MAX_MONTHLY:
      return { plan: "max", interval: "monthly" };
    case env.STRIPE_PRICE_MAX_YEARLY:
      return { plan: "max", interval: "yearly" };
    default:
      return null;
  }
}

export function planToPriceId(plan: PaidPlan, interval: Interval): string | null {
  if (plan === "pro" && interval === "monthly") return env.STRIPE_PRICE_PRO_MONTHLY ?? null;
  if (plan === "pro" && interval === "yearly") return env.STRIPE_PRICE_PRO_YEARLY ?? null;
  if (plan === "max" && interval === "monthly") return env.STRIPE_PRICE_MAX_MONTHLY ?? null;
  if (plan === "max" && interval === "yearly") return env.STRIPE_PRICE_MAX_YEARLY ?? null;
  return null;
}

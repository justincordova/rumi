import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const PLAN_LIMITS = {
  free: { maxRooms: 3, maxTabsPerRoom: 3, maxConcurrentUsers: 5 },
  pro: { maxRooms: 25, maxTabsPerRoom: 10, maxConcurrentUsers: 15 },
  max: { maxRooms: 100, maxTabsPerRoom: 50, maxConcurrentUsers: 50 },
} as const;

export const MAX_ROOMS_OPEN = 10;

export type PlanType = keyof typeof PLAN_LIMITS;

export interface PlanLimits {
  plan: PlanType;
  maxRooms: number;
  maxTabsPerRoom: number;
  maxConcurrentUsers: number;
}

export interface SubscriptionRow {
  plan: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

export function resolvePlan(row: SubscriptionRow | null): PlanLimits {
  if (!row) return { plan: "free", ...PLAN_LIMITS.free };

  const now = new Date();
  const periodValid = row.currentPeriodEnd && row.currentPeriodEnd > now;
  const isActive = row.status === "active" || row.status === "past_due";

  // An `active`/`past_due` subscription is entitled without requiring
  // `currentPeriodEnd` to be in the future. Two reasons:
  //   1. `past_due` is the dunning grace period — Stripe keeps retrying
  //      payment after the period elapses, and the documented intent
  //      (billing/service.ts mapStripeStatus) is to keep access alive until
  //      the subscription is actually canceled. Requiring `periodValid` here
  //      would strip access the moment a renewal payment was late.
  //   2. `currentPeriodEnd` can legitimately be null on a freshly-created
  //      active row (the field moved to subscription items in Stripe SDK v22
  //      and is read with optional chaining), which would otherwise drop a
  //      paying customer to free.
  //
  // Exception: when the subscription is `active` but scheduled to cancel at
  // period end (`cancelAtPeriodEnd`), the period boundary is the only signal
  // we have locally that the paid window has closed. If we never received the
  // period-end webhook, honoring `cancelAtPeriodEnd` + period keeps us from
  // granting access indefinitely on a sub that should have lapsed.
  const activeEntitled = isActive && (!row.cancelAtPeriodEnd || periodValid);

  // A subscription that's been canceled (status='canceled') keeps paid
  // access until the end of the already-paid-for billing period. The
  // billing webhook leaves `plan` and `currentPeriodEnd` intact when
  // cancellation fires; we just need to respect that here. Without this
  // branch, status='canceled' immediately drops the user to free and
  // contradicts the documented behavior in AGENTS.md.
  const canceledButValid = row.status === "canceled" && periodValid;

  const stillEntitled = activeEntitled || canceledButValid;
  if (stillEntitled) {
    const limits = PLAN_LIMITS[row.plan as PlanType] ?? PLAN_LIMITS.free;
    return { plan: row.plan as PlanType, ...limits };
  }

  return { plan: "free", ...PLAN_LIMITS.free };
}

export async function getUserPlan(userId: string): Promise<PlanLimits> {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  return resolvePlan(row as SubscriptionRow | null);
}

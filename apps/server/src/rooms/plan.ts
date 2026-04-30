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
  const inTrial = row.trialEndsAt && row.trialEndsAt > now;
  const periodValid = row.currentPeriodEnd && row.currentPeriodEnd > now;
  const isActive = row.status === "active" || row.status === "past_due";
  const canceledButValid = row.cancelAtPeriodEnd && periodValid;

  if (isActive && (inTrial || periodValid || canceledButValid)) {
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

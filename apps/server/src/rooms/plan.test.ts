import { describe, expect, it } from "bun:test";
import { PLAN_LIMITS, resolvePlan } from "./plan";

const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe("resolvePlan", () => {
  it("returns free limits when no row exists", () => {
    const result = resolvePlan(null);
    expect(result.plan).toBe("free");
    expect(result.maxRooms).toBe(PLAN_LIMITS.free.maxRooms);
  });

  it("returns pro limits for active pro subscription", () => {
    const result = resolvePlan({
      plan: "pro",
      status: "active",
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      currentPeriodEnd: futureDate,
    });
    expect(result.plan).toBe("pro");
    expect(result.maxRooms).toBe(PLAN_LIMITS.pro.maxRooms);
  });

  it("returns plan limits when canceled but period not ended", () => {
    const result = resolvePlan({
      plan: "pro",
      status: "active",
      cancelAtPeriodEnd: true,
      trialEndsAt: null,
      currentPeriodEnd: futureDate,
    });
    expect(result.plan).toBe("pro");
  });

  it("returns free when canceled and period ended", () => {
    const result = resolvePlan({
      plan: "pro",
      status: "active",
      cancelAtPeriodEnd: true,
      trialEndsAt: null,
      currentPeriodEnd: pastDate,
    });
    expect(result.plan).toBe("free");
  });

  it("returns plan limits during trial", () => {
    const result = resolvePlan({
      plan: "max",
      status: "active",
      cancelAtPeriodEnd: false,
      trialEndsAt: futureDate,
      currentPeriodEnd: null,
    });
    expect(result.plan).toBe("max");
    expect(result.maxRooms).toBe(PLAN_LIMITS.max.maxRooms);
  });

  it("returns plan limits for past_due status (grace period)", () => {
    const result = resolvePlan({
      plan: "pro",
      status: "past_due",
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      currentPeriodEnd: futureDate,
    });
    expect(result.plan).toBe("pro");
  });
});

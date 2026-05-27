import { apiFetch } from "@/lib/api";
import type { GetSubscriptionResponse, Subscription } from "@rumi/protocol";
import { create } from "zustand";

interface SubscriptionState {
  subscription: Subscription | null;
  status: "idle" | "loading" | "ready" | "error";
  fetch: () => Promise<Subscription | null>;
  pollUntilPlanChange: (fromPlan: string) => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionState>()((set, get) => ({
  subscription: null,
  status: "idle",
  fetch: async () => {
    // Only flip to "loading" on the FIRST fetch. During pollUntilPlanChange's
    // 5-tick poll, flipping to loading on every tick caused UI subscribers
    // (PlanBadge etc.) to flash to a skeleton placeholder 5 times during
    // what should look like a single smooth transition.
    if (get().status === "idle") set({ status: "loading" });
    try {
      const data = await apiFetch<GetSubscriptionResponse>("/api/subscriptions/me");
      set({ subscription: data.subscription, status: "ready" });
      return data.subscription;
    } catch {
      set({ status: "error" });
      return null;
    }
  },
  pollUntilPlanChange: async (fromPlan: string) => {
    const delays = [0, 750, 1500, 2500, 4000];
    for (const delay of delays) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const sub = await get().fetch();
      if (sub && sub.plan !== fromPlan) return;
    }
  },
}));

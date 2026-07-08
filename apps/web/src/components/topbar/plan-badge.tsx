import { CheckoutModal } from "@/components/billing/checkout-modal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import { useSubscriptionStore } from "@/stores/subscription";
import { useNavigate } from "@tanstack/react-router";
import { Globe, Layout, Users, Zap } from "lucide-react";
import { useEffect, useState } from "react";

const PLAN_LIMITS: Record<"free" | "pro" | "max", { rooms: string; tabs: string; users: string }> =
  {
    free: { rooms: "3", tabs: "3 per room", users: "5 concurrent" },
    pro: { rooms: "25", tabs: "10 per room", users: "15 concurrent" },
    max: { rooms: "100", tabs: "50 per room", users: "50 concurrent" },
  };

export function PlanBadge() {
  const navigate = useNavigate();
  const subscription = useSubscriptionStore((s) => s.subscription);
  const subStatus = useSubscriptionStore((s) => s.status);
  const fetchSub = useSubscriptionStore((s) => s.fetch);
  const pollUntilPlanChange = useSubscriptionStore((s) => s.pollUntilPlanChange);
  const [checkoutPlan, setCheckoutPlan] = useState<"pro" | "max" | null>(null);
  const embeddedEnabled = Boolean(env.VITE_STRIPE_PUBLISHABLE_KEY);

  // Fetch on mount; also retry a previous failure so one transient blip
  // doesn't pin the badge to "Free" for the whole session. Mount-only so a
  // persistent outage can't retry-loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate mount-only retry
  useEffect(() => {
    if (subStatus === "idle" || subStatus === "error") void fetchSub();
  }, []);

  if (subStatus === "idle" || subStatus === "loading") {
    return <div className="h-6 w-20 rounded-full bg-muted animate-pulse-soft" />;
  }

  const plan = (subscription?.plan as "free" | "pro" | "max") ?? "free";
  const isPaid = plan !== "free";
  const label = plan === "free" ? "Free" : plan === "pro" ? "Pro" : "Max";
  const limits = PLAN_LIMITS[plan];
  const nextPlan = PLANS.find((p) => p.key === (plan === "free" ? "pro" : "max"));

  return (
    <>
      {embeddedEnabled && checkoutPlan && (
        <CheckoutModal
          open={checkoutPlan !== null}
          onOpenChange={(open) => {
            if (!open) {
              setCheckoutPlan(null);
              void pollUntilPlanChange("free");
            }
          }}
          plan={checkoutPlan}
          interval="monthly"
        />
      )}

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} plan — view details`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
              isPaid
                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/30"
            }`}
          >
            <Zap className="h-3 w-3" />
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-64 p-0 overflow-hidden">
          <div className={`px-4 py-3 ${isPaid ? "bg-primary/5" : "bg-muted/40"}`}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">{label} plan</span>
              {isPaid && (
                <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  Active
                </span>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {PLANS.find((p) => p.key === plan)?.description}
            </p>
          </div>

          <div className="px-4 py-3 space-y-2.5 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                Rooms
              </div>
              <span className="text-[12px] font-medium tabular-nums">{limits.rooms}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Layout className="h-3.5 w-3.5 shrink-0" />
                Tabs
              </div>
              <span className="text-[12px] font-medium tabular-nums">{limits.tabs}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Users className="h-3.5 w-3.5 shrink-0" />
                Collaborators
              </div>
              <span className="text-[12px] font-medium tabular-nums">{limits.users}</span>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-border">
            {isPaid ? (
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() =>
                    navigate({ to: "/settings", search: { tab: "billing", checkout: undefined } })
                  }
                  className="rounded-sm text-[12px] text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Manage billing
                </button>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/pricing" })}
                  className="rounded-sm text-[12px] text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View plans
                </button>
              </div>
            ) : nextPlan ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground text-center">
                  Upgrade to {nextPlan.name} for {nextPlan.price.monthly}/mo
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (embeddedEnabled) {
                      setCheckoutPlan("pro");
                    } else {
                      navigate({ to: "/pricing" });
                    }
                  }}
                  className="w-full rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                >
                  Upgrade to Pro
                </button>
                {embeddedEnabled && (
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/pricing" })}
                    className="w-full rounded-sm text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    View all plans
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

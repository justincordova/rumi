import { CheckoutModal } from "@/components/billing/checkout-modal";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { COMPARISON_ROWS, PLANS, type PlanKey } from "@/lib/plans";
import { useSubscriptionStore } from "@/stores/subscription";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

type Interval = "monthly" | "yearly";

export function PricingSection() {
  const [interval, setInterval] = useState<Interval>("monthly");
  const { status } = useSession();
  const authenticated = status === "authenticated";
  const subscription = useSubscriptionStore((s) => s.subscription);
  const fetchSub = useSubscriptionStore((s) => s.fetch);
  const pollUntilPlanChange = useSubscriptionStore((s) => s.pollUntilPlanChange);
  const [checkoutPlan, setCheckoutPlan] = useState<"pro" | "max" | null>(null);
  const embeddedEnabled = Boolean(env.VITE_STRIPE_PUBLISHABLE_KEY);
  const navigate = useNavigate();

  const plan = (subscription?.plan as PlanKey) ?? "free";

  // Fetch on mount/sign-in; also retry a previous failure so a paid user
  // isn't shown Free-plan CTAs after one transient blip. Reads status via
  // getState in the effect body so a persistent outage can't retry-loop.
  useEffect(() => {
    const s = useSubscriptionStore.getState().status;
    if (authenticated && (s === "idle" || s === "error")) void fetchSub();
  }, [authenticated, fetchSub]);

  function handleUpgrade(targetPlan: "pro" | "max") {
    // Someone who already pays for a plan must switch through the Stripe
    // Customer Portal (reachable from Settings → Billing). Embedded Checkout
    // runs in `mode: "subscription"` and would add a SECOND subscription to
    // the same customer, billing them for both plans concurrently.
    if (plan !== "free") {
      void navigate({ to: "/settings", search: { tab: "billing", checkout: undefined } });
      return;
    }
    setCheckoutPlan(targetPlan);
  }

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 pt-10 pb-20">
      {embeddedEnabled && checkoutPlan && (
        <CheckoutModal
          open={checkoutPlan !== null}
          onOpenChange={(open) => {
            if (!open) {
              setCheckoutPlan(null);
              // Poll against the *current* plan, not "free" — otherwise an
              // existing Pro user upgrading to Max sees the loop exit on the
              // first poll (current=pro !== "free") before the webhook lands,
              // leaving the UI stuck on "Pro" until manual reload.
              void pollUntilPlanChange(plan);
            }
          }}
          plan={checkoutPlan}
          interval={interval}
        />
      )}
      <div className="text-center mb-10">
        {/* h1: this is the only heading on /pricing (the section is not reused
            elsewhere), so starting the outline at h2 left the page with none. */}
        <h1 className="font-display text-3xl font-bold tracking-tight">Simple pricing</h1>
        <p className="mt-2 text-muted-foreground text-[15px]">
          Start free, upgrade when you need more.
        </p>
        <div
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-1"
          aria-label="Billing interval"
        >
          <button
            type="button"
            onClick={() => setInterval("monthly")}
            aria-pressed={interval === "monthly"}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              interval === "monthly"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("yearly")}
            aria-pressed={interval === "yearly"}
            className={`relative rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              interval === "yearly"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Yearly
            {/* Solid rather than a 10% tint: brand purple on its own tint
                measured 4.01:1 at 10px, and the purple has too little headroom
                on a light background for any tint to reach 4.5:1. Filled gives
                5.4:1 and matches the "Recommended" badge below. */}
            <span className="ml-1.5 inline-flex items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              -17%
            </span>
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((p) => {
          const isPro = p.key === "pro";
          const isCurrent = authenticated && plan === p.key;
          return (
            <div
              key={p.key}
              className={`relative rounded-xl flex flex-col transition-all duration-200 ${
                isPro
                  ? "border-2 border-primary/50 bg-surface shadow-float scale-[1.02] z-10"
                  : "border border-border bg-surface"
              }`}
            >
              {isPro && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 animate-gradient bg-gradient-to-r from-[#8839ef] via-[#ea76cb] to-[#8839ef] bg-[length:200%_200%] rounded-full px-3 py-1 text-[11px] font-semibold text-white dark:from-[#cba6f7] dark:via-[#f5c2e7] dark:to-[#cba6f7]">
                    <Sparkles className="h-3 w-3" />
                    Recommended
                  </span>
                </div>
              )}

              <div className={`px-6 pt-8 pb-5 ${isPro ? "bg-primary/[0.03]" : ""}`}>
                {/* h2: the plan names sit directly under the page h1, so h3
                    skipped a level. */}
                <h2
                  className={`text-lg font-semibold tracking-tight ${isPro ? "text-primary" : "text-foreground"}`}
                >
                  {p.name}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                <div className="mt-4">
                  {interval === "yearly" && p.key !== "free" ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold tracking-tight">
                        {p.monthlyEquivalent.yearly}
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                      <span className="text-sm text-muted-foreground line-through">
                        {p.price.monthly}/mo
                      </span>
                    </div>
                  ) : (
                    <>
                      <span className="text-4xl font-bold tracking-tight">{p.price[interval]}</span>
                      <span className="text-sm text-muted-foreground ml-0.5">
                        {p.period[interval]}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="px-6 pb-6 flex flex-col flex-1">
                <ul className="space-y-3 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="text-sm text-muted-foreground flex items-center gap-2.5">
                      <Check
                        className={`h-4 w-4 shrink-0 ${isPro ? "text-primary" : "text-muted-foreground/60"}`}
                      />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {isCurrent ? (
                    <div className="h-9 flex items-center justify-center rounded-lg border border-dashed border-border">
                      <span className="text-xs font-medium text-muted-foreground">
                        Current plan
                      </span>
                    </div>
                  ) : p.key === "free" ? (
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link to="/sign-in" search={{ next: "/dashboard" }}>
                        Get started
                      </Link>
                    </Button>
                  ) : authenticated ? (
                    <Button
                      variant={isPro ? "default" : "outline"}
                      size="sm"
                      className="w-full"
                      onClick={() => handleUpgrade(p.key as "pro" | "max")}
                    >
                      Upgrade
                    </Button>
                  ) : (
                    <Button
                      asChild
                      variant={isPro ? "default" : "outline"}
                      size="sm"
                      className="w-full"
                    >
                      <Link to="/sign-in" search={{ next: `/pricing?plan=${p.key}` }}>
                        Upgrade
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-14 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-3 pr-4 text-left font-medium text-muted-foreground">Feature</th>
              {PLANS.map((p) => (
                <th key={p.key} className="px-4 py-3 text-center font-medium text-muted-foreground">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-border/50">
                <td className="py-2.5 pr-4 text-foreground">{row.label}</td>
                <td className="px-4 py-2.5 text-center text-muted-foreground">{row.free}</td>
                <td className="px-4 py-2.5 text-center text-muted-foreground">{row.pro}</td>
                <td className="px-4 py-2.5 text-center text-muted-foreground">{row.max}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

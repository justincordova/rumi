import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { COMPARISON_ROWS, PLANS, type PlanKey } from "@/lib/plans";
import type { GetSubscriptionResponse } from "@rumi/protocol";
import { Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

type Interval = "monthly" | "yearly";

export function PricingSection() {
  const [interval, setInterval] = useState<Interval>("monthly");
  const { status } = useSession();
  const authenticated = status === "authenticated";
  const [plan, setPlan] = useState<PlanKey>("free");

  useEffect(() => {
    if (!authenticated) return;
    apiFetch<GetSubscriptionResponse>("/api/subscriptions/me")
      .then((data) => {
        if (data.subscription) {
          setPlan(data.subscription.plan as PlanKey);
        }
      })
      .catch(() => {});
  }, [authenticated]);

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 pt-10 pb-20">
      <div className="text-center mb-10">
        <h2 className="font-display text-3xl font-bold tracking-tight">Simple pricing</h2>
        <p className="mt-2 text-muted-foreground text-[15px]">
          Start free, upgrade when you need more.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-1">
          <button
            type="button"
            onClick={() => setInterval("monthly")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
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
            className={`relative rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
              interval === "yearly"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Yearly
            <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              -25%
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
                <h3
                  className={`text-lg font-semibold tracking-tight ${isPro ? "text-primary" : "text-foreground"}`}
                >
                  {p.name}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                <div className="mt-4">
                  {interval === "yearly" && p.key !== "free" ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold tracking-tight">
                        {p.monthlyEquivalent.yearly}
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                      <span className="text-sm text-muted-foreground/50 line-through">
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
                    <Link to="/sign-in" search={{ next: "/dashboard" }}>
                      <Button variant="outline" size="sm" className="w-full">
                        Get started
                      </Button>
                    </Link>
                  ) : authenticated ? (
                    <Button
                      variant={isPro ? "default" : "outline"}
                      size="sm"
                      className="w-full"
                      disabled
                    >
                      Upgrade
                    </Button>
                  ) : (
                    <Link to="/sign-in" search={{ next: `/pricing?plan=${p.key}` }}>
                      <Button variant={isPro ? "default" : "outline"} size="sm" className="w-full">
                        Upgrade
                      </Button>
                    </Link>
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

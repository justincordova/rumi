import { TopBar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { GetSubscriptionResponse } from "@rumi/protocol";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authed/upgrade")({
  component: UpgradePage,
});

const PLAN_COLORS = {
  free: {
    card: "border-border",
    header: "text-foreground",
    accent: "bg-muted/50",
  },
  pro: {
    card: "border-blue-500/40 ring-1 ring-blue-500/20",
    header: "text-blue-600",
    accent: "bg-blue-500/5",
  },
  max: {
    card: "border-purple-500/40 ring-1 ring-purple-500/20",
    header: "text-purple-600",
    accent: "bg-purple-500/5",
  },
} as const;

const PLANS = [
  {
    key: "free" as const,
    name: "Free",
    price: "$0",
    period: "/mo",
    features: ["3 rooms", "3 tabs per room", "5 concurrent users"],
    popular: false,
  },
  {
    key: "pro" as const,
    name: "Pro",
    price: "$8",
    period: "/mo",
    features: ["25 rooms", "10 tabs per room", "15 concurrent users", "File uploads (20MB)"],
    popular: true,
  },
  {
    key: "max" as const,
    name: "Max",
    price: "$20",
    period: "/mo",
    features: ["100 rooms", "50 tabs per room", "50 concurrent users", "File uploads (50MB)"],
    popular: false,
  },
] as const;

const COMPARISON_ROWS = [
  { label: "Rooms", free: "3", pro: "25", max: "100" },
  { label: "Tabs per room", free: "3", pro: "10", max: "50" },
  { label: "Concurrent users", free: "5", pro: "15", max: "50" },
  { label: "File uploads", free: "—", pro: "20MB", max: "50MB", planned: true },
  { label: "Export (PDF/SVG)", free: "—", pro: "✓", max: "✓", planned: true },
  { label: "Priority support", free: "—", pro: "—", max: "✓" },
];

function UpgradePage() {
  const [plan, setPlan] = useState<"free" | "pro" | "max">("free");

  useEffect(() => {
    apiFetch<GetSubscriptionResponse>("/api/subscriptions/me")
      .then((data) => {
        if (data.subscription) {
          setPlan(data.subscription.plan as "free" | "pro" | "max");
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar label="Upgrade" />
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {PLANS.map((p) => {
            const isCurrent = plan === p.key;
            const colors = PLAN_COLORS[p.key];
            return (
              <div
                key={p.key}
                className={`relative border rounded-xl overflow-hidden flex flex-col ${colors.card}`}
              >
                <div className={`px-5 pt-5 pb-3 ${colors.accent}`}>
                  {p.popular && (
                    <span className="inline-block mb-2 rounded-full bg-blue-600 text-white px-2.5 py-0.5 text-[11px] font-semibold">
                      Popular
                    </span>
                  )}
                  <h3 className={`text-base font-semibold ${colors.header}`}>{p.name}</h3>
                  <div className="mt-1">
                    <span className="text-2xl font-bold">{p.price}</span>
                    <span className="text-sm text-muted-foreground">{p.period}</span>
                  </div>
                </div>
                <div className="px-5 py-4 flex flex-col flex-1">
                  <ul className="space-y-2 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="text-sm text-muted-foreground flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5">
                    {isCurrent ? (
                      <div className="h-9 flex items-center justify-center rounded-md border border-dashed border-border">
                        <span className="text-xs font-medium text-muted-foreground">
                          Current plan
                        </span>
                      </div>
                    ) : (
                      <Button
                        variant={p.popular ? "default" : "outline"}
                        size="sm"
                        className="w-full"
                        disabled
                      >
                        Upgrade
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <section className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground" />
                <th className="text-center py-3 px-4 font-semibold">Free</th>
                <th className="text-center py-3 px-4 font-semibold text-blue-600">Pro</th>
                <th className="text-center py-3 px-4 font-semibold text-purple-600">Max</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="py-2.5 px-4 text-muted-foreground">
                    {row.label}
                    {row.planned && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide">
                        Planned
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center">{row.free}</td>
                  <td className="py-2.5 px-4 text-center">{row.pro}</td>
                  <td className="py-2.5 px-4 text-center">{row.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

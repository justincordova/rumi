import { TopBar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { GetSubscriptionResponse } from "@rumi/protocol";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authed/upgrade")({
  component: UpgradePage,
});

const PLANS = [
  {
    key: "free" as const,
    name: "Free",
    price: "$0",
    period: "/mo",
    description: "For trying things out",
    features: ["3 rooms", "3 tabs per room", "5 concurrent users"],
  },
  {
    key: "pro" as const,
    name: "Pro",
    price: "$8",
    period: "/mo",
    description: "For individuals and small teams",
    features: ["25 rooms", "10 tabs per room", "15 concurrent users", "File uploads (20MB)"],
  },
  {
    key: "max" as const,
    name: "Max",
    price: "$20",
    period: "/mo",
    description: "For power users and larger teams",
    features: [
      "100 rooms",
      "50 tabs per room",
      "50 concurrent users",
      "File uploads (50MB)",
      "Priority support",
    ],
  },
] as const;

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
    <div className="h-screen overflow-hidden flex flex-col">
      <TopBar />
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="max-w-5xl w-full space-y-10">
          <div className="text-center space-y-3 animate-fade-in">
            <h1 className="text-2xl font-display font-semibold tracking-tight">
              Pick the plan that fits your workflow
            </h1>
            <p className="text-muted-foreground text-[15px]">
              All plans include real-time collaboration, drawing boards, and Markdown + code
              editors.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {PLANS.map((p) => {
              const isCurrent = plan === p.key;
              const isPro = p.key === "pro";
              return (
                <div
                  key={p.key}
                  className={`relative rounded-xl flex flex-col transition-all duration-200 ${
                    isPro
                      ? "border-2 border-primary/50 bg-surface shadow-float scale-[1.03] z-10"
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
                      <span className="text-4xl font-bold tracking-tight">{p.price}</span>
                      <span className="text-sm text-muted-foreground ml-0.5">{p.period}</span>
                    </div>
                  </div>

                  <div className="px-6 pb-6 flex flex-col flex-1">
                    <ul className="space-y-3 flex-1">
                      {p.features.map((f) => (
                        <li
                          key={f}
                          className="text-sm text-muted-foreground flex items-center gap-2.5"
                        >
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
                      ) : (
                        <Button
                          variant={isPro ? "default" : "outline"}
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

          <p className="text-center text-[13px] text-muted-foreground">
            Questions?{" "}
            <a
              href="mailto:support@rumi.dev"
              className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
            >
              Reach out
            </a>{" "}
            — we're happy to help.
          </p>
        </div>
      </main>
    </div>
  );
}

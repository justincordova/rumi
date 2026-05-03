export type PlanKey = "free" | "pro" | "max";

export interface PlanDef {
  key: PlanKey;
  name: string;
  price: { monthly: string; yearly: string };
  monthlyEquivalent: { yearly: string };
  period: { monthly: string; yearly: string };
  description: string;
  features: string[];
}

export const PLANS: readonly PlanDef[] = [
  {
    key: "free",
    name: "Free",
    price: { monthly: "$0", yearly: "$0" },
    monthlyEquivalent: { yearly: "$0" },
    period: { monthly: "/mo", yearly: "/yr" },
    description: "For trying things out",
    features: ["3 rooms", "3 tabs per room", "5 concurrent users"],
  },
  {
    key: "pro",
    name: "Pro",
    price: { monthly: "$8", yearly: "$72" },
    monthlyEquivalent: { yearly: "$6" },
    period: { monthly: "/mo", yearly: "/yr" },
    description: "For individuals and small teams",
    features: [
      "25 rooms",
      "10 tabs per room",
      "15 concurrent users",
      "Export tabs (Markdown, code, PNG, SVG)",
    ],
  },
  {
    key: "max",
    name: "Max",
    price: { monthly: "$20", yearly: "$180" },
    monthlyEquivalent: { yearly: "$15" },
    period: { monthly: "/mo", yearly: "/yr" },
    description: "For power users and larger teams",
    features: [
      "100 rooms",
      "50 tabs per room",
      "50 concurrent users",
      "Export tabs (Markdown, code, PNG, SVG)",
      "Priority support",
    ],
  },
] as const;

export const COMPARISON_ROWS = [
  { label: "Rooms", free: "3", pro: "25", max: "100" },
  { label: "Tabs per room", free: "3", pro: "10", max: "50" },
  { label: "Concurrent users", free: "5", pro: "15", max: "50" },
  { label: "Export tabs", free: "—", pro: "✓", max: "✓" },
  { label: "Support", free: "Community", pro: "Email", max: "Priority" },
  { label: "Real-time collab", free: "✓", pro: "✓", max: "✓" },
  { label: "Markdown + code tabs", free: "✓", pro: "✓", max: "✓" },
  { label: "Drawing boards", free: "✓", pro: "✓", max: "✓" },
  { label: "Guest access", free: "✓", pro: "✓", max: "✓" },
] as const;

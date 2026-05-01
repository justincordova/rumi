import { TopBar } from "@/components/topbar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { linkProvider, signOut, useSession } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import type { GetSubscriptionResponse } from "@rumi/protocol";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, CreditCard, Download, Github, LogOut, Settings2, Trash2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const settingsTabSchema = z.enum(["general", "account", "billing"]).catch("general");

export const Route = createFileRoute("/_authed/settings")({
  validateSearch: (search) => ({ tab: settingsTabSchema.parse(search.tab) }),
  component: SettingsPage,
});

type Tab = z.infer<typeof settingsTabSchema>;

const TABS: { value: Tab; label: string; icon: typeof Settings2 }[] = [
  { value: "general", label: "General", icon: Settings2 },
  { value: "account", label: "Account", icon: User },
  { value: "billing", label: "Billing", icon: CreditCard },
];

function SettingsPage() {
  const tab = Route.useSearch({ select: (s) => s.tab });
  const navigate = useNavigate();

  function setTab(value: Tab) {
    navigate({ to: "/settings", search: { tab: value } });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 max-w-2xl w-full mx-auto px-6 pt-6 pb-8 space-y-5">
        <h1 className="text-2xl font-display font-semibold tracking-tight">Settings</h1>

        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  tab === t.value
                    ? "bg-surface text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "general" && <GeneralTab />}
        {tab === "account" && <AccountTab />}
        {tab === "billing" && <BillingTab />}
      </main>
    </div>
  );
}

function GeneralTab() {
  return (
    <div className="space-y-4">
      <AppearanceSection />
      <NotificationsSection />
    </div>
  );
}

function AppearanceSection() {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);

  return (
    <section className="border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Appearance</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Customize how Rumi looks on your screen.
        </p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">Theme</span>
        <div className="flex gap-1 rounded-lg border p-1">
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                theme === t
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function NotificationsSection() {
  return (
    <section className="border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Notifications</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Email and desktop notification preferences.
        </p>
      </div>
      <div className="flex items-center justify-center py-5 rounded-lg border border-dashed border-border">
        <span className="text-sm text-muted-foreground">Coming soon</span>
      </div>
    </section>
  );
}

function AccountTab() {
  return (
    <div className="space-y-4">
      <ProfileSection />
      <LinkedAccountsSection />
      <DangerZoneSection />
      <div className="flex justify-center pt-4">
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

function ProfileSection() {
  const { user } = useSession();
  const [name, setName] = useState(user?.displayName ?? "");

  function commit() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== user?.displayName) {
      toast.info("Coming soon");
    }
  }

  return (
    <section className="border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Profile</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Your public display name and email.
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <span className="text-sm text-muted-foreground mb-1.5 block">Display name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            className="max-w-sm"
          />
        </div>
        <div>
          <span className="text-sm text-muted-foreground mb-1.5 block">Email</span>
          <p className="text-sm">{user?.email}</p>
        </div>
      </div>
    </section>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="Google"
    >
      <title>Google</title>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

const SUPPORTED_PROVIDERS = [
  {
    id: "github" as const,
    name: "GitHub",
    Icon: Github,
    linkedBorder: "border-[#24292e]/30",
    linkedBg: "bg-[#24292e]/5",
    iconColor: "text-[#24292e] dark:text-white",
    badgeBg: "bg-[#24292e]/10",
    badgeBorder: "border-[#24292e]/20",
    badgeText: "text-[#24292e] dark:text-white",
  },
  {
    id: "google" as const,
    name: "Google",
    Icon: GoogleIcon,
    linkedBorder: "border-[#4285F4]/30",
    linkedBg: "bg-[#4285F4]/5",
    iconColor: "text-[#4285F4]",
    badgeBg: "bg-[#4285F4]/10",
    badgeBorder: "border-[#4285F4]/20",
    badgeText: "text-[#4285F4]",
  },
];

function LinkedAccountsSection() {
  const { user } = useSession();
  const linkedProviders = new Set(user?.identities?.map((i) => i.provider) ?? []);

  async function handleLink(providerId: "github" | "google") {
    try {
      await linkProvider(providerId);
    } catch {
      toast.error(`Couldn't link ${providerId === "github" ? "GitHub" : "Google"} account`);
    }
  }

  return (
    <section className="border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Linked Accounts</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Connect providers for one-click sign-in.
        </p>
      </div>
      <div className="space-y-2">
        {SUPPORTED_PROVIDERS.map((p) => {
          const linked = linkedProviders.has(p.id);
          const { Icon } = p;
          return (
            <div
              key={p.id}
              className={`flex items-center justify-between py-2.5 px-3 rounded-lg border transition-colors ${
                linked
                  ? `${p.linkedBorder} ${p.linkedBg}`
                  : "opacity-60 border-border bg-transparent"
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 ${linked ? p.iconColor : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">{p.name}</span>
              </div>
              {linked ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${p.badgeBg} ${p.badgeBorder} ${p.badgeText}`}
                >
                  <Check className="h-3 w-3" />
                  Connected
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLink(p.id)}
                  className="h-7 text-xs"
                >
                  Link
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DangerZoneSection() {
  const [confirmText, setConfirmText] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <section className="border border-destructive/30 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Trash2 className="h-4 w-4 text-destructive" />
        <h2 className="text-[15px] font-semibold text-destructive">Delete account</h2>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Permanently delete your account and all associated data. This cannot be undone.
      </p>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm">
            Delete account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All your rooms, tabs, and data will be permanently
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">
              Type <strong>DELETE</strong> to confirm
            </span>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="font-mono"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE"}
              onClick={() => {
                toast.info("Coming soon");
                setConfirmText("");
                setOpen(false);
              }}
            >
              Delete account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

const MOCK_INVOICES = [
  { id: "INV-001", date: "Mar 1, 2026", total: "$0.00", status: "Paid" as const },
  { id: "INV-002", date: "Feb 1, 2026", total: "$0.00", status: "Paid" as const },
  { id: "INV-003", date: "Jan 1, 2026", total: "$0.00", status: "Paid" as const },
];

function BillingTab() {
  const navigate = useNavigate();
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

  const planLabel = plan === "max" ? "Max" : plan.charAt(0).toUpperCase() + plan.slice(1);

  const planBadgeClass =
    plan === "pro"
      ? "bg-primary/10 text-primary border-primary/20"
      : plan === "max"
        ? "bg-primary/10 text-primary border-primary/20"
        : "bg-muted text-muted-foreground border-border";

  return (
    <div className="space-y-4">
      <CurrentPlanSection
        planLabel={planLabel}
        planBadgeClass={planBadgeClass}
        onUpgrade={() => navigate({ to: "/upgrade" })}
      />
      <BillingHistorySection />
      <CancelPlanSection />
    </div>
  );
}

function CurrentPlanSection({
  planLabel,
  planBadgeClass,
  onUpgrade,
}: {
  planLabel: string;
  planBadgeClass: string;
  onUpgrade: () => void;
}) {
  return (
    <section className="border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Current plan</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Your active subscription and usage limits.
        </p>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${planBadgeClass}`}
          >
            {planLabel}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onUpgrade}>
          Change plan
        </Button>
      </div>
    </section>
  );
}

function BillingHistorySection() {
  return (
    <section className="border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Billing history</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Payment method and past invoices.
        </p>
      </div>
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <CreditCard className="h-4 w-4" />
          <span>No payment method on file</span>
        </div>
        <button
          type="button"
          onClick={() => toast.info("Coming soon")}
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Add
        </button>
      </div>
      <div className="border-t pt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-2 font-medium text-muted-foreground text-[13px]">Date</th>
              <th className="pb-2 font-medium text-muted-foreground text-[13px]">Total</th>
              <th className="pb-2 font-medium text-muted-foreground text-[13px]">Status</th>
              <th className="pb-2 font-medium text-muted-foreground text-[13px] text-right">
                Receipt
              </th>
            </tr>
          </thead>
          <tbody>
            {MOCK_INVOICES.map((inv) => (
              <tr key={inv.id} className="border-t first:border-t-0">
                <td className="py-2.5">{inv.date}</td>
                <td className="py-2.5">{inv.total}</td>
                <td className="py-2.5">
                  <span className="inline-flex items-center rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    {inv.status}
                  </span>
                </td>
                <td className="py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => toast.info("Coming soon")}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CancelPlanSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <section className="border rounded-xl p-5 space-y-3">
      <h2 className="text-[15px] font-semibold">Cancel plan</h2>
      <p className="text-[13px] text-muted-foreground">
        Downgrade to the Free plan at the end of your billing period. Rooms exceeding free limits
        become read-only.
      </p>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="text-sm text-destructive/70 hover:text-destructive transition-colors"
          >
            Cancel my plan
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel plan?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll be downgraded to the Free plan at the end of your current billing period.
              Rooms exceeding the free limits will become read-only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep plan</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                toast.info("Coming soon");
                setConfirmOpen(false);
              }}
            >
              Cancel plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

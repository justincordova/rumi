import { CheckoutModal } from "@/components/billing/checkout-modal";
import { RouteError } from "@/components/route-error";
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
import { ApiError, apiFetch } from "@/lib/api";
import { linkProvider, signOut, useSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { usePrefs } from "@/lib/prefs";
import { useSeoMeta } from "@/lib/seo";
import { useSubscriptionStore } from "@/stores/subscription";
import type {
  DeleteAccountBlockedResponse,
  DeleteAccountResponse,
  PortalResponse,
  UpdateAccountResponse,
} from "@rumi/protocol";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  CreditCard,
  ExternalLink,
  Github,
  LogOut,
  Settings2,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const settingsTabSchema = z.enum(["general", "account", "billing"]).catch("general");
const checkoutStateSchema = z.enum(["success", "cancel"]).optional().catch(undefined);

export const Route = createFileRoute("/_authed/settings")({
  validateSearch: (search) => ({
    tab: settingsTabSchema.parse(search.tab),
    checkout: checkoutStateSchema.parse((search as Record<string, unknown>).checkout),
  }),
  component: SettingsPage,
  errorComponent: SettingsRouteError,
});

function SettingsRouteError({ error, reset }: { error: Error; reset: () => void }) {
  return <RouteError error={error} reset={reset} boundary="settings" />;
}

type Tab = z.infer<typeof settingsTabSchema>;

const TABS: { value: Tab; label: string; icon: typeof Settings2 }[] = [
  { value: "general", label: "General", icon: Settings2 },
  { value: "account", label: "Account", icon: User },
  { value: "billing", label: "Billing", icon: CreditCard },
];

function SettingsPage() {
  const tab = Route.useSearch({ select: (s) => s.tab });
  const navigate = useNavigate();
  const router = useRouter();

  useSeoMeta({
    title: "Settings",
    description: "Manage your Rumi account, plan, and notifications.",
    noindex: true,
  });

  function setTab(value: Tab) {
    navigate({ to: "/settings", search: { tab: value, checkout: undefined } });
  }

  const goBack = () => {
    if (window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: "/dashboard" });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 max-w-2xl w-full mx-auto px-6 pt-6 pb-8 space-y-5">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <h1 className="text-2xl font-display font-semibold tracking-tight">Settings</h1>

        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                aria-current={tab === t.value ? "page" : undefined}
                className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
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
              aria-pressed={theme === t}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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

interface NotificationPrefs {
  emailEnabled: boolean;
  accessGrantedEmail: boolean;
  inviteAcceptedEmail: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  emailEnabled: true,
  accessGrantedEmail: true,
  inviteAcceptedEmail: true,
};

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  // The visible label is a plain sibling span, so the switch had no accessible
  // name — screen readers announced only "switch, checked". Point at the span
  // rather than duplicating the string into aria-label so the two cannot drift.
  const labelId = useId();
  return (
    <div className="flex items-center justify-between">
      <span id={labelId} className={`text-sm ${disabled ? "text-muted-foreground" : ""}`}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-primary" : "bg-input"}`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}

function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // A failed fetch used to install DEFAULT_PREFS, which renders identically to
  // server-loaded data — so a user who had turned email off was shown all three
  // switches ON with no indication anything had gone wrong, and reasonably
  // concluded their opt-out had been lost. Surface the failure instead.
  useEffect(() => {
    apiFetch<{ preferences: NotificationPrefs }>("/api/notifications/preferences")
      .then((r) => {
        setPrefs(r.preferences);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  async function update(patch: Partial<NotificationPrefs>) {
    const prev = prefs;
    const optimistic = { ...(prefs ?? DEFAULT_PREFS), ...patch };
    setPrefs(optimistic);
    try {
      const res = await apiFetch<{ preferences: NotificationPrefs }>(
        "/api/notifications/preferences",
        { method: "PATCH", body: patch },
      );
      setPrefs(res.preferences);
    } catch {
      // Roll back to the pre-optimistic state so the toggle doesn't stay
      // flipped while the server still holds the old value.
      setPrefs(prev);
      toast.error("Couldn't update preferences");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Notifications</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Email and desktop notification preferences.
        </p>
      </div>
      {loadFailed ? (
        <div className="flex items-center justify-center py-5 rounded-lg border border-dashed border-border">
          <span className="text-sm text-muted-foreground">
            Couldn&apos;t load your notification preferences. Refresh to try again.
          </span>
        </div>
      ) : !prefs ? (
        <div className="flex items-center justify-center py-5 rounded-lg border border-dashed border-border">
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : (
        <div className="space-y-3">
          <ToggleRow
            label="Email notifications"
            checked={prefs.emailEnabled}
            onChange={(v) => update({ emailEnabled: v })}
          />
          <div className="pl-4 space-y-2 border-l border-border">
            <ToggleRow
              label="When someone gives me access to a room"
              checked={prefs.accessGrantedEmail}
              disabled={!prefs.emailEnabled}
              onChange={(v) => update({ accessGrantedEmail: v })}
            />
            <ToggleRow
              label="When someone accepts my invite"
              checked={prefs.inviteAcceptedEmail}
              disabled={!prefs.emailEnabled}
              onChange={(v) => update({ inviteAcceptedEmail: v })}
            />
          </div>
        </div>
      )}
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
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
  const setSession = useSession((s) => s._set);
  const [name, setName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);

  async function commit() {
    const trimmed = name.trim();
    // An empty name is rejected by the server (min length 1), so there is
    // nothing to save — but leaving the input blank made it look like the
    // clear had been accepted while the TopBar still showed the old name.
    // Put the current value back so the field matches reality.
    if (!trimmed) {
      setName(user?.displayName ?? "");
      return;
    }
    if (trimmed === user?.displayName) return;
    if (trimmed.length > 80) {
      toast.error("Display name must be 80 characters or fewer");
      setName(user?.displayName ?? "");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<UpdateAccountResponse>("/api/account", {
        method: "PATCH",
        body: { displayName: trimmed },
      });
      if (user) {
        setSession({ user: { ...user, displayName: res.user.displayName } });
      }
      toast.success("Display name updated");
    } catch {
      toast.error("Couldn't update display name");
      setName(user?.displayName ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Profile</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Your public display name and email.
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <label
            htmlFor="settings-display-name"
            className="text-sm text-muted-foreground mb-1.5 block"
          >
            Display name
          </label>
          <Input
            id="settings-display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            disabled={saving}
            className="max-w-sm"
            maxLength={80}
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
    // Google blue on its own 10% tint measures 2.70:1 (light) / 4.10:1 (dark)
    // at 12px, under the 4.5:1 AA floor. The brand mark stays in `iconColor`;
    // the status word does not need to be brand-coloured. GitHub's badge
    // already passes (9.81:1 / 17.22:1) and is left alone.
    badgeText: "text-foreground",
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
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
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
  const [deleting, setDeleting] = useState(false);
  const [blockingRooms, setBlockingRooms] = useState<
    DeleteAccountBlockedResponse["error"]["rooms"] | null
  >(null);
  const navigate = useNavigate();

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch<DeleteAccountResponse>("/api/account", { method: "DELETE" });
      toast.success("Account deleted");
      await signOut();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ownership_transfer_required") {
        const body = err.body as DeleteAccountBlockedResponse | undefined;
        const list = body?.error.rooms ?? [];
        setBlockingRooms(list);
        // Close the confirm dialog. The blocking-rooms panel renders in the
        // section body, i.e. OUTSIDE the AlertDialog — leaving the dialog open
        // buries it behind Radix's modal overlay and inside the inert
        // outside-content region, so the user can never see (or click) the
        // rooms they have to transfer.
        setOpen(false);
        setConfirmText("");
        toast.error(
          `Transfer ownership of ${list.length} ${
            list.length === 1 ? "room" : "rooms"
          } before deleting your account.`,
        );
      } else {
        toast.error("Couldn't delete account. Try again or contact support.");
      }
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-xl border border-destructive/30 bg-surface p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Trash2 className="h-4 w-4 text-destructive" />
        <h2 className="text-[15px] font-semibold text-destructive">Delete account</h2>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Permanently delete your account and all associated data. Rooms with other members require
        ownership transfer first. Solo-owned rooms move to trash and are purged after 30 days.
      </p>
      {blockingRooms && blockingRooms.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <p className="text-[13px] font-medium text-destructive">
            Transfer ownership before deleting:
          </p>
          <ul className="space-y-1">
            {blockingRooms.map((r) => (
              <li key={r.slug} className="text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void navigate({
                      to: "/r/$slug",
                      params: { slug: r.slug },
                      search: { tab: undefined },
                    });
                  }}
                  className="rounded-sm text-primary hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {r.name ?? r.slug}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
              This action cannot be undone. Your account, notification preferences, and membership
              in shared rooms will be removed. Rooms you solely own will be moved to trash and
              purged after 30 days.
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
            {/* Deliberately does NOT clear blockingRooms — that list is the
                only place the user can find out which rooms need an ownership
                transfer, and it lives outside this dialog. */}
            <AlertDialogCancel onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || deleting}
              onClick={() => {
                void handleDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function BillingTab() {
  const navigate = useNavigate();
  const checkout = Route.useSearch({ select: (s) => s.checkout });
  const subscription = useSubscriptionStore((s) => s.subscription);
  const subStatus = useSubscriptionStore((s) => s.status);
  const fetchSub = useSubscriptionStore((s) => s.fetch);
  const pollUntilPlanChange = useSubscriptionStore((s) => s.pollUntilPlanChange);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<"pro" | "max" | null>(null);
  const [checkoutInterval, setCheckoutInterval] = useState<"monthly" | "yearly">("monthly");
  const embeddedEnabled = Boolean(env.VITE_STRIPE_PUBLISHABLE_KEY);

  // Fetch on mount; also retry a previous failure so the billing tab doesn't
  // show Free-plan state for a paid user after one transient blip.
  // Mount-only so a persistent outage can't retry-loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate mount-only retry
  useEffect(() => {
    if (subStatus === "idle" || subStatus === "error") void fetchSub();
  }, []);

  const checkoutRef = useRef(checkout);
  useEffect(() => {
    const initial = checkoutRef.current;
    if (initial === "success") {
      toast.success("You're now subscribed. Welcome to your new plan!");
      // Poll from the plan we currently hold, not a hardcoded "free" — a
      // pro→max upgrade would otherwise exit on the first tick (pro !== free)
      // before the webhook flips the plan, leaving a stale badge.
      const fromPlan = useSubscriptionStore.getState().subscription?.plan ?? "free";
      void pollUntilPlanChange(fromPlan);
      navigate({ to: "/settings", search: { tab: "billing", checkout: undefined }, replace: true });
    } else if (initial === "cancel") {
      toast.info("Checkout canceled — you're still on the Free plan.");
      navigate({ to: "/settings", search: { tab: "billing", checkout: undefined }, replace: true });
    }
  }, [pollUntilPlanChange, navigate]);

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const { url } = await apiFetch<PortalResponse>("/api/billing/portal", { method: "POST" });
      window.location.href = url;
    } catch (err) {
      if (err instanceof ApiError && err.code === "no_stripe_customer") {
        navigate({ to: "/pricing" });
      } else if (err instanceof ApiError && err.code === "stripe_not_configured") {
        toast.info("Billing isn't enabled in this environment yet.");
      } else {
        toast.error("Couldn't open billing portal. Please try again.");
      }
      setPortalLoading(false);
    }
  }

  const loaded = subStatus === "ready" || subStatus === "error";
  const plan = subscription?.plan ?? "free";
  const isPaid = plan !== "free";

  const planLabel = plan === "max" ? "Max" : plan.charAt(0).toUpperCase() + plan.slice(1);
  const planBadgeClass =
    plan === "pro" || plan === "max"
      ? "bg-primary/10 text-primary border-primary/20"
      : "bg-muted text-muted-foreground border-border";

  const periodEnd = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  if (!loaded) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4 animate-pulse-soft">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-3 w-48 rounded bg-muted" />
          <div className="flex items-center justify-between">
            <div className="h-7 w-16 rounded-full bg-muted" />
            <div className="h-8 w-24 rounded-md bg-muted" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4 animate-pulse-soft">
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-3 w-64 rounded bg-muted" />
          <div className="h-8 w-32 rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {embeddedEnabled && checkoutPlan && (
        <CheckoutModal
          open={checkoutPlan !== null}
          onOpenChange={(open) => {
            if (!open) {
              setCheckoutPlan(null);
              void pollUntilPlanChange(plan);
            }
          }}
          plan={checkoutPlan}
          interval={checkoutInterval}
        />
      )}

      {/* Current plan */}
      <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
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
            {isPaid && periodEnd && (
              <span className="text-[13px] text-muted-foreground">
                {subscription?.cancelAtPeriodEnd ? `Cancels ${periodEnd}` : `Renews ${periodEnd}`}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isPaid && portalLoading}
            onClick={() => {
              // An existing subscriber must change plans through the Stripe
              // Customer Portal, which mutates the live subscription in place.
              // Opening embedded Checkout here would create a SECOND
              // subscription on the same customer and bill them twice (the
              // server rejects it with `invalid_state` for the same reason).
              if (isPaid) {
                handlePortal();
              } else if (embeddedEnabled) {
                setCheckoutPlan("pro");
                setCheckoutInterval("monthly");
              } else {
                navigate({ to: "/pricing" });
              }
            }}
          >
            {isPaid ? "Change plan" : "Upgrade"}
          </Button>
        </div>
      </section>

      {/* Billing management */}
      {isPaid ? (
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div>
            <h2 className="text-[15px] font-semibold">Billing</h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              View invoices, update your payment method, or change plans via the Stripe billing
              portal.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePortal}
            disabled={portalLoading}
            className="gap-2"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {portalLoading ? "Opening…" : "Manage billing"}
          </Button>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div>
            <h2 className="text-[15px] font-semibold">Billing</h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              You&apos;re on the Free plan. Upgrade to unlock more rooms, tabs, and concurrent
              users.
            </p>
          </div>
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <CreditCard className="h-4 w-4 shrink-0" />
            <span>No payment method on file.</span>
            <button
              type="button"
              onClick={() => {
                if (embeddedEnabled) {
                  setCheckoutPlan("pro");
                  setCheckoutInterval("monthly");
                } else {
                  navigate({ to: "/pricing" });
                }
              }}
              className="text-primary hover:text-primary/80 transition-colors underline-offset-2 hover:underline"
            >
              View upgrade options
            </button>
          </div>
        </section>
      )}

      {/* Cancel plan — only shown for paid users */}
      {isPaid && <CancelPlanSection onOpenPortal={handlePortal} portalLoading={portalLoading} />}
    </div>
  );
}

function CancelPlanSection({
  onOpenPortal,
  portalLoading,
}: {
  onOpenPortal: () => void;
  portalLoading: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
      <h2 className="text-[15px] font-semibold">Cancel plan</h2>
      <p className="text-[13px] text-muted-foreground">
        Downgrade to the Free plan at the end of your billing period. You&apos;ll keep access until
        your period ends.
      </p>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="text-sm text-destructive underline-offset-2 transition-colors hover:underline"
          >
            Cancel my plan
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel plan?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll be redirected to the Stripe billing portal to cancel. Access continues
              through the end of your current billing period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep plan</AlertDialogCancel>
            <AlertDialogAction
              disabled={portalLoading}
              onClick={() => {
                setConfirmOpen(false);
                onOpenPortal();
              }}
            >
              Continue to portal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

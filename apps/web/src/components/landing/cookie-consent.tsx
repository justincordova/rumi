import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

type Consent = {
  necessary: true;
  analytics: boolean;
  /**
   * Legacy field kept for backward-compat with any saved consent records.
   * No marketing tooling currently reads it; the toggle was removed in the
   * pre-launch hardening pass.
   */
  marketing?: boolean;
  timestamp: number;
};

const KEY = "rumi_cookie_consent";

export function getConsent(): Consent | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

function setConsent(c: Consent) {
  localStorage.setItem(KEY, JSON.stringify(c));
  window.dispatchEvent(new Event("rumi-consent-changed"));
}

export function CookieBanner({
  onManagePreferences,
}: {
  onManagePreferences: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => getConsent() !== null);

  // The preferences modal is a sibling, not a child: when the user records a
  // decision there, this component never re-reads localStorage and the banner
  // stays up. They then have no way to dismiss it except "Accept all" /
  // "Necessary only", which writes a fresh record and silently overwrites the
  // analytics choice they just saved.
  useEffect(() => {
    const onChange = () => setDismissed(getConsent() !== null);
    window.addEventListener("rumi-consent-changed", onChange);
    return () => window.removeEventListener("rumi-consent-changed", onChange);
  }, []);

  if (dismissed) return null;

  function acceptAll() {
    setConsent({
      necessary: true,
      analytics: true,
      timestamp: Date.now(),
    });
    setDismissed(true);
  }

  function acceptNecessary() {
    setConsent({
      necessary: true,
      analytics: false,
      timestamp: Date.now(),
    });
    setDismissed(true);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-border bg-background p-4 shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-300">
      <p className="text-sm text-muted-foreground mb-3">
        We use cookies to improve your experience. You can choose which cookies to allow.{" "}
        <Link
          to="/privacy"
          hash="cookies"
          className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Learn more
        </Link>
        .
      </p>
      {/* min-h-11 (44px): these three sit adjacent on a phone and a mis-tap
          between "Accept all" and "Necessary only" silently changes the
          user's privacy choice. They measured 30px and 28px tall at 360px. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={acceptAll}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={acceptNecessary}
          className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Necessary only
        </button>
        <button
          type="button"
          onClick={onManagePreferences}
          className="inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Manage preferences
        </button>
      </div>
    </div>
  );
}

export function CookiePreferencesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [analytics, setAnalytics] = useState(() => getConsent()?.analytics ?? false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape so this hand-rolled modal behaves like a real dialog.
  // Also pull focus into the dialog on open so keyboard users aren't left
  // with focus on the underlying page where Tab cycles through hidden
  // elements behind the overlay.
  useEffect(() => {
    if (!open) return;
    // Re-read the stored record every time the modal opens. The lazy
    // initializer above runs once at mount — before the user can click
    // "Accept all" on the banner — so without this the Analytics switch shows
    // a stale `false` while the stored record says `true`, and "Save
    // preferences" then writes that stale value back, silently revoking
    // consent the user granted.
    setAnalytics(getConsent()?.analytics ?? false);
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  function save() {
    setConsent({
      necessary: true,
      analytics,
      timestamp: Date.now(),
    });
    onOpenChange(false);
  }

  return (
    <div className={open ? "fixed inset-0 z-50 flex items-center justify-center" : "hidden"}>
      <button
        type="button"
        className="fixed inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200 cursor-default"
        onClick={() => onOpenChange(false)}
        aria-label="Close"
      />
      <div
        ref={dialogRef}
        // biome-ignore lint/a11y/useSemanticElements: native <dialog>'s top-layer doesn't compose with our custom backdrop button + animate-in classes
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg animate-in zoom-in-95 fade-in duration-200 outline-none"
      >
        <h2 id={titleId} className="text-lg font-semibold mb-1">
          Cookie preferences
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose which cookies you want to allow.{" "}
          <Link to="/privacy" hash="cookies" className="underline underline-offset-2">
            Learn more
          </Link>
          .
        </p>
        <div className="space-y-3">
          <CookieToggle
            label="Necessary"
            description="Required for the app to function. Cannot be disabled."
            checked
            disabled
          />
          <CookieToggle
            label="Analytics"
            description="Help us understand how the app is used."
            checked={analytics}
            onChange={setAnalytics}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

function CookieToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (val: boolean) => void;
}) {
  // A wrapping <label> does not name a role="switch" button, so these toggles
  // were announced as just "switch, checked". Reference the visible text and
  // description explicitly instead.
  const labelId = useId();
  const descId = useId();
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium">
          {label}
        </p>
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          checked ? "bg-primary" : "bg-muted"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

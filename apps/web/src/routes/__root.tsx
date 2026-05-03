import { CookieBanner, CookiePreferencesModal } from "@/components/landing/cookie-consent";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { maybeLoadAnalytics } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { ThemeProvider } from "@/lib/theme";
import { Link, Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorBoundary,
});

function RootLayout() {
  const [cookiePrefsOpen, setCookiePrefsOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Don't show the banner while reading the legal pages — visually noisy.
  const hideCookieBanner = pathname === "/privacy" || pathname === "/terms";

  // Load analytics whenever consent changes.
  useEffect(() => {
    maybeLoadAnalytics();
    const handler = () => maybeLoadAnalytics();
    window.addEventListener("rumi-consent-changed", handler);
    return () => window.removeEventListener("rumi-consent-changed", handler);
  }, []);

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={150}>
        <Outlet />
        <ThemedToaster />
        {!hideCookieBanner && (
          <>
            <CookieBanner onManagePreferences={() => setCookiePrefsOpen(true)} />
            <CookiePreferencesModal open={cookiePrefsOpen} onOpenChange={setCookiePrefsOpen} />
          </>
        )}
      </TooltipProvider>
    </ThemeProvider>
  );
}

function RootErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: "root" } });
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-display font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        We hit an unexpected error. Try reloading the page, or head back to{" "}
        <Link to="/" className="underline underline-offset-2">
          the home page
        </Link>
        .
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

// Sonner toaster bound to next-themes + design tokens
function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme as "light" | "dark" | "system"}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "group bg-background text-foreground border-border shadow-lg",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
        },
      }}
    />
  );
}

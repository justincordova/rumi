import { CookieBanner, CookiePreferencesModal } from "@/components/landing/cookie-consent";
import { RouteError } from "@/components/route-error";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { maybeLoadAnalytics } from "@/lib/analytics";
import { ThemeProvider } from "@/lib/theme";
import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
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
  return <RouteError error={error} reset={reset} boundary="root" showReload />;
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

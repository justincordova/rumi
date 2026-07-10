import { Button } from "@/components/ui/button";
import { Sentry } from "@/lib/sentry";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

interface Props {
  error: Error;
  reset: () => void;
  /** Tagged on Sentry events so we can tell boundaries apart in the dashboard. */
  boundary: string;
  /** Optional path to navigate "home" to. Defaults to /dashboard. */
  homePath?: string;
  homeLabel?: string;
  /**
   * When true, offer a hard page reload instead of a router link. Used by the
   * app-root boundary, where a corrupted router state may make in-app
   * navigation unreliable.
   */
  showReload?: boolean;
}

/**
 * Reusable route-level error boundary fallback.
 *
 * TanStack Router's `errorComponent` mounts this when a child throws. Reports
 * to Sentry and offers a way out (retry or home). Also used by the app-root
 * error boundary via `showReload` so every "Something went wrong" screen looks
 * and behaves identically.
 */
export function RouteError({
  error,
  reset,
  boundary,
  homePath = "/dashboard",
  homeLabel = "Back to dashboard",
  showReload = false,
}: Props) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary } });
  }, [error, boundary]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-display font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        {showReload
          ? "We hit an unexpected error. Try again, or reload the page."
          : "We hit an unexpected error on this page. Try again, or head back home."}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        {showReload ? (
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        ) : (
          <Button asChild>
            <Link to={homePath}>{homeLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

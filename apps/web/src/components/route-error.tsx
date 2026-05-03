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
}

/**
 * Reusable route-level error boundary fallback.
 *
 * TanStack Router's `errorComponent` mounts this when a child throws. Reports
 * to Sentry and offers a way out (retry or home).
 */
export function RouteError({
  error,
  reset,
  boundary,
  homePath = "/dashboard",
  homeLabel = "Back to dashboard",
}: Props) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary } });
  }, [error, boundary]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-display font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        We hit an unexpected error on this page. Try again, or head back home.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          Try again
        </button>
        <Link
          to={homePath}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// Reject any `next` value that could redirect off-origin. TanStack Router's
// `to` prop already rejects unknown routes, but a path-traversal-ish value
// like `//evil.com` or `/\\evil.com` is a path string and must be rejected
// before it reaches the router.
function safeNext(raw: unknown): string {
  if (typeof raw !== "string") return "/dashboard";
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

export const Route = createFileRoute("/auth/callback")({
  component: CallbackPage,
  validateSearch: (s) => ({
    next: safeNext((s as { next?: unknown }).next),
  }),
});

function CallbackPage() {
  const { next } = Route.useSearch();
  const nav = useNavigate();

  useEffect(() => {
    nav({ to: next });
  }, [next, nav]);

  return (
    <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">
      Signing in…
    </div>
  );
}

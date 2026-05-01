import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/auth/callback")({
  component: CallbackPage,
  validateSearch: (s) => ({
    next: typeof s.next === "string" ? s.next : "/dashboard",
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

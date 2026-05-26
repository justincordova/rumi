import { RouteError } from "@/components/route-error";
import { useSession } from "@/lib/auth";
import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authed")({
  // bootstrap() awaits initAuth() before rendering, so by the time the router
  // runs `status` is either "authenticated" or "anonymous" on the initial
  // load. The "loading" state only appears during an in-app session reset
  // (rare). Redirect on anything other than "authenticated" so we never
  // briefly render a protected child with `user === null`.
  beforeLoad: ({ location }) => {
    const { status } = useSession.getState();
    if (status !== "authenticated") {
      throw redirect({ to: "/sign-in", search: { next: location.pathname } });
    }
  },
  component: AuthedLayout,
  errorComponent: AuthedRouteError,
});

function AuthedLayout() {
  const status = useSession((s) => s.status);
  const navigate = useNavigate();

  // Mid-session sign-out (token revoked, refresh failed) flips status away
  // from "authenticated" — push the user back to /sign-in immediately and
  // hold the outlet so we don't render a stale page in the meantime.
  useEffect(() => {
    if (status !== "authenticated") {
      navigate({
        to: "/sign-in",
        search: { next: window.location.pathname || "/dashboard" },
      });
    }
  }, [status, navigate]);

  if (status !== "authenticated") return null;
  return <Outlet />;
}

function AuthedRouteError({ error, reset }: { error: Error; reset: () => void }) {
  return <RouteError error={error} reset={reset} boundary="authed" />;
}

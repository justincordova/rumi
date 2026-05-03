import { RouteError } from "@/components/route-error";
import { useSession } from "@/lib/auth";
import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ location }) => {
    const { status } = useSession.getState();
    if (status === "anonymous") {
      throw redirect({ to: "/sign-in", search: { next: location.pathname } });
    }
  },
  component: AuthedLayout,
  errorComponent: AuthedRouteError,
});

function AuthedLayout() {
  const status = useSession((s) => s.status);
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "anonymous") {
      navigate({ to: "/sign-in", search: { next: "/dashboard" } });
    }
  }, [status, navigate]);

  return <Outlet />;
}

function AuthedRouteError({ error, reset }: { error: Error; reset: () => void }) {
  return <RouteError error={error} reset={reset} boundary="authed" />;
}

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/upgrade")({
  beforeLoad: () => {
    throw redirect({ to: "/pricing" });
  },
});

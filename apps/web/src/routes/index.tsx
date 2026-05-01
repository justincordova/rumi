import { LandingPage } from "@/components/landing/landing-page";
import { useSession } from "@/lib/auth";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const { status } = useSession.getState();
    if (status === "authenticated") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: LandingPage,
});

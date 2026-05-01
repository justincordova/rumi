import { LandingFooter } from "@/components/landing/landing-footer";
import { PricingNav } from "@/components/landing/pricing-nav";
import { PricingSection } from "@/components/landing/pricing-section";
import { TopBar } from "@/components/topbar";
import { useSession } from "@/lib/auth";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const { status } = useSession();
  const authenticated = status === "authenticated";
  const router = useRouter();

  const goBack = () => {
    if (window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: authenticated ? "/dashboard" : "/" });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {authenticated ? <TopBar /> : <PricingNav />}
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </div>
        <PricingSection />
      </main>
      <LandingFooter onCookiePreferences={() => {}} />
    </div>
  );
}

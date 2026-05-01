import { LandingFooter } from "@/components/landing/landing-footer";
import { PricingNav } from "@/components/landing/pricing-nav";
import { PricingSection } from "@/components/landing/pricing-section";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <PricingNav />
      <main className="flex-1">
        <PricingSection />
      </main>
      <LandingFooter onCookiePreferences={() => {}} />
    </div>
  );
}

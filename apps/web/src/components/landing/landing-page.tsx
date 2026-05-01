import logoT from "@/assets/logos/logo-t.png";
import { maybeLoadAnalytics } from "@/lib/analytics";
import { useSession } from "@/lib/auth";
import { useSeoMeta } from "@/lib/seo";
import { Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CookieBanner, CookiePreferencesModal } from "./cookie-consent";
import { Hero } from "./hero";
import { LandingFooter } from "./landing-footer";
import { LandingNav } from "./landing-nav";
import { Reveal } from "./reveal";
import { Sandbox } from "./sandbox/sandbox";

export function LandingPage() {
  const status = useSession((s) => s.status);
  const [cookiePrefsOpen, setCookiePrefsOpen] = useState(false);

  useSeoMeta();

  useEffect(() => {
    maybeLoadAnalytics();
    const handler = () => maybeLoadAnalytics();
    window.addEventListener("rumi-consent-changed", handler);
    return () => window.removeEventListener("rumi-consent-changed", handler);
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <img src={logoT} alt="Rumi" className="h-10 w-10 animate-pulse" />
      </div>
    );
  }

  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col relative">
      <div className="absolute inset-0 bg-gradient-subtle pointer-events-none" />
      <div className="relative z-10 flex flex-col min-h-screen">
        <LandingNav />
        <main className="flex-1">
          <Hero />
          <Reveal>
            <Sandbox />
          </Reveal>
        </main>
        <LandingFooter onCookiePreferences={() => setCookiePrefsOpen(true)} />
      </div>
      <CookieBanner onManagePreferences={() => setCookiePrefsOpen(true)} />
      <CookiePreferencesModal open={cookiePrefsOpen} onOpenChange={setCookiePrefsOpen} />
    </div>
  );
}

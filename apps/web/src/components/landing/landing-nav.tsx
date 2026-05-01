import logoT from "@/assets/logos/logo-t.png";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <img src={logoT} alt="Rumi" className="h-7 w-7" />
          <span className="font-display text-[15px] font-semibold tracking-tight">Rumi</span>
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          <a
            href="/pricing"
            className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Pricing
          </a>
          <Link
            to="/sign-in"
            search={{ next: "/dashboard" }}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Sign in
          </Link>
        </nav>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-surface px-6 pb-4 pt-2 md:hidden">
          <div className="flex flex-col gap-2">
            <a
              href="/pricing"
              className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground text-center"
              onClick={() => setMobileOpen(false)}
            >
              Pricing
            </a>
            <Link
              to="/sign-in"
              search={{ next: "/dashboard" }}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground text-center"
              onClick={() => setMobileOpen(false)}
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

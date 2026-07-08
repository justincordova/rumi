import logoT from "@/assets/logos/logo-t.png";
import { Link } from "@tanstack/react-router";

export function LandingFooter({ onCookiePreferences }: { onCookiePreferences: () => void }) {
  return (
    <footer className="mt-12 bg-gradient-to-t from-muted/30 to-transparent">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <img src={logoT} alt="Rumi" className="h-4 w-4" />
            <span className="font-display text-xs font-semibold tracking-tight">Rumi</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/sign-in"
              search={{ next: "/dashboard" }}
              className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </Link>
            <Link
              to="/privacy"
              className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Terms
            </Link>
            <button
              type="button"
              onClick={onCookiePreferences}
              className="rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cookies
            </button>
          </nav>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground/50">
          &copy; {new Date().getFullYear()} Rumi
        </p>
      </div>
    </footer>
  );
}

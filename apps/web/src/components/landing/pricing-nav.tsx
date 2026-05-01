import logoT from "@/assets/logos/logo-t.png";
import { Link } from "@tanstack/react-router";

export function PricingNav() {
  return (
    <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md border-b border-border">
      <div className="mx-auto flex h-14 max-w-6xl items-center px-6">
        <Link to="/" className="flex items-center gap-2">
          <img src={logoT} alt="Rumi" className="h-7 w-7" />
          <span className="font-display text-[15px] font-semibold tracking-tight">Rumi</span>
        </Link>
      </div>
    </header>
  );
}

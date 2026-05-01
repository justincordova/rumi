import logoT from "@/assets/logos/logo-t.png";
import { useSession } from "@/lib/auth";
import { Link, useRouter } from "@tanstack/react-router";
import { X } from "lucide-react";

export function PricingNav() {
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
    <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <img src={logoT} alt="Rumi" className="h-7 w-7" />
          <span className="font-display text-[15px] font-semibold tracking-tight">Rumi</span>
        </Link>
        <button
          type="button"
          onClick={goBack}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

import logoT from "@/assets/logos/logo-t.png";
import { Button } from "@/components/ui/button";

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
      <img src={logoT} alt="Rumi" className="h-24 w-24 mb-6" />
      <h2 className="font-display text-3xl font-semibold tracking-tight text-balance">
        Start your first room
      </h2>
      <p className="text-muted-foreground mt-2 max-w-md text-[15px] leading-relaxed text-balance">
        Create a shared workspace. Anyone with the link will see your edits in real time.
      </p>
      <Button onClick={onCreate} size="lg" className="mt-8">
        Create room
      </Button>
      <p className="text-[12px] text-muted-foreground mt-6">
        You can create up to <span className="font-medium text-foreground">3 rooms</span> on the
        free plan.
      </p>
    </div>
  );
}

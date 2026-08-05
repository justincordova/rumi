import logoT from "@/assets/logos/logo-t.png";
import { Button } from "@/components/ui/button";
import { PLAN_LIMITS, type PlanKey } from "@/lib/plans";
import { useSubscriptionStore } from "@/stores/subscription";

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  // The cap was hardcoded to the free plan's 3, so a Pro or Max subscriber who
  // had no rooms yet was told a limit far below what they pay for.
  const plan = useSubscriptionStore((s) => (s.subscription?.plan ?? "free") as PlanKey);
  const maxRooms = PLAN_LIMITS[plan].maxRooms;
  const planLabel = plan === "free" ? "free plan" : `${plan === "pro" ? "Pro" : "Max"} plan`;

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
        You can create up to{" "}
        <span className="font-medium text-foreground">
          {maxRooms} {maxRooms === 1 ? "room" : "rooms"}
        </span>{" "}
        on the {planLabel}.
      </p>
    </div>
  );
}

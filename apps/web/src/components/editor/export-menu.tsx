import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSubscriptionStore } from "@/stores/subscription";
import { Download } from "lucide-react";
import { useEffect } from "react";

export interface ExportOption {
  label: string;
  onSelect: () => void | Promise<void>;
}

interface Props {
  options: ExportOption[];
}

/**
 * Plan-gated export dropdown. Free users see a disabled button with an
 * "Upgrade for Pro" tooltip. Pro/Max users get the dropdown of options.
 */
export function ExportMenu({ options }: Props) {
  const subscription = useSubscriptionStore((s) => s.subscription);
  const status = useSubscriptionStore((s) => s.status);
  const fetchSub = useSubscriptionStore((s) => s.fetch);

  // Lazy fetch on first mount so the gate has accurate plan info. Also retry
  // a previous failure (status "error") — otherwise one transient network
  // blip downgrades a paid user to the Free gate for the rest of the session.
  // Mount-only so a persistent outage can't retry-loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate mount-only retry
  useEffect(() => {
    if (status === "idle" || status === "error") void fetchSub();
  }, []);

  const plan = subscription?.plan ?? "free";
  const isPaid = plan !== "free";

  if (!isPaid) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span needed because disabled buttons don't fire pointer events */}
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              disabled
              aria-label="Export (Pro)"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Upgrade to Pro to export tabs</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md"
          title="Export"
          aria-label="Export"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt.label} onSelect={() => void opt.onSelect()}>
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { LANGUAGES } from "@/lib/markdown/languages";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface Props {
  roomSlug: string;
  tabId: string;
  value: string | null;
  /**
   * Language change is a structural mutation — admin+ only on the server
   * (updateTab). When false, render a static label instead of a dropdown
   * that's guaranteed to fail with a toast.
   */
  canManage?: boolean;
}

export function LanguagePicker({ roomSlug, tabId, value, canManage = true }: Props) {
  const displayName = value ? (LANGUAGES[value]?.name ?? value) : "Plain text";

  if (!canManage) {
    return (
      <span className="inline-flex h-6 items-center px-2 text-[11px] text-muted-foreground">
        {displayName}
      </span>
    );
  }

  async function select(language: string | null) {
    try {
      await apiFetch(`/api/rooms/${roomSlug}/tabs/${tabId}`, {
        method: "PATCH",
        body: { language },
      });
    } catch {
      toast.error("Couldn't change language");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] gap-1">
          {displayName}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-40">
        <DropdownMenuItem onSelect={() => select(null)} className="gap-2">
          {value === null ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <span className="w-3.5" aria-hidden />
          )}
          Plain text
        </DropdownMenuItem>
        {Object.entries(LANGUAGES).map(([id, lang]) => (
          <DropdownMenuItem key={id} onSelect={() => select(id)} className="gap-2">
            {value === id ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <span className="w-3.5" aria-hidden />
            )}
            {lang.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

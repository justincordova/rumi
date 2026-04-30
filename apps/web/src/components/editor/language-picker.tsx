import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { LANGUAGES } from "@/lib/markdown/languages";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface Props {
  roomSlug: string;
  tabId: string;
  value: string | null;
}

export function LanguagePicker({ roomSlug, tabId, value }: Props) {
  const displayName = value ? (LANGUAGES[value]?.name ?? value) : "Plain text";

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
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => select(null)}>Plain text</DropdownMenuItem>
        {Object.entries(LANGUAGES).map(([id, lang]) => (
          <DropdownMenuItem key={id} onSelect={() => select(id)}>
            {lang.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

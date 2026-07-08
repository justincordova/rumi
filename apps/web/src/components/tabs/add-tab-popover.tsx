import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Code2, FileText, PenLine, Plus } from "lucide-react";
import { useState } from "react";

interface Props {
  onAdd: (type: "tab" | "drawing") => void;
  atCap?: boolean;
  onAtCapClick?: () => void;
}

export function AddTabPopover({ onAdd, atCap, onAtCapClick }: Props) {
  const [open, setOpen] = useState(false);

  function select(type: "tab" | "drawing") {
    onAdd(type);
    setOpen(false);
  }

  // When at cap, short-circuit the popover and surface the upgrade message instead.
  if (atCap) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-md shrink-0"
        onClick={onAtCapClick}
        title="Tab limit reached — upgrade for more"
        aria-label="Tab limit reached — upgrade for more"
      >
        <Plus className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md shrink-0"
          title="Add tab"
          aria-label="Add tab"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5 animate-scale-in" align="start">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground px-2 py-1.5">
          New tab
        </p>
        <button
          type="button"
          onClick={() => select("tab")}
          className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface shrink-0">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-medium">Code</p>
            <p className="text-[12px] text-muted-foreground">Markdown, code, or plain text</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => select("drawing")}
          className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface shrink-0">
            <PenLine className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-medium">Drawing</p>
            <p className="text-[12px] text-muted-foreground">Collaborative whiteboard</p>
          </div>
        </button>
      </PopoverContent>
    </Popover>
  );
}

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { EDITOR_FONTS, type EditorFontKey } from "@/lib/fonts";
import { usePrefs } from "@/lib/prefs";
import { Check, Minus, Plus } from "lucide-react";

export function AppearanceItems() {
  return (
    <>
      <EditorFontItem />
      <FontSizeItem />
      <WordWrapItem />
      <CompactModeItem />
    </>
  );
}

function EditorFontItem() {
  const editorFont = usePrefs((s) => s.editorFont);
  const setEditorFont = usePrefs((s) => s.setEditorFont);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Font</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {(
          Object.entries(EDITOR_FONTS) as [EditorFontKey, (typeof EDITOR_FONTS)[EditorFontKey]][]
        ).map(([key, font]) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => setEditorFont(key)}
            className="flex items-center gap-2"
          >
            {editorFont === key && <Check className="h-3.5 w-3.5" />}
            <span className={editorFont === key ? "" : "ml-[20px]"}>{font.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function FontSizeItem() {
  const fontSize = usePrefs((s) => s.fontSize);
  const setFontSize = usePrefs((s) => s.setFontSize);
  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-sm">
      <span>Font size</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setFontSize(Math.max(10, fontSize - 1))}
          className="grid h-6 w-6 place-items-center rounded hover:bg-muted"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-6 text-center text-xs tabular-nums">{fontSize}</span>
        <button
          type="button"
          onClick={() => setFontSize(Math.min(24, fontSize + 1))}
          className="grid h-6 w-6 place-items-center rounded hover:bg-muted"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function WordWrapItem() {
  const wordWrap = usePrefs((s) => s.wordWrap);
  const setWordWrap = usePrefs((s) => s.setWordWrap);
  return (
    <DropdownMenuItem className="flex items-center gap-2" onSelect={() => setWordWrap(!wordWrap)}>
      {wordWrap && <Check className="h-3.5 w-3.5" />}
      <span className={wordWrap ? "" : "ml-[20px]"}>Word wrap</span>
    </DropdownMenuItem>
  );
}

function CompactModeItem() {
  const compactMode = usePrefs((s) => s.compactMode);
  const setCompactMode = usePrefs((s) => s.setCompactMode);
  return (
    <DropdownMenuItem
      className="flex items-center gap-2"
      onSelect={() => setCompactMode(!compactMode)}
    >
      {compactMode && <Check className="h-3.5 w-3.5" />}
      <span className={compactMode ? "" : "ml-[20px]"}>Compact mode</span>
    </DropdownMenuItem>
  );
}

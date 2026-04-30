import { Button } from "@/components/ui/button";
import { Columns2, Eye, FileText } from "lucide-react";
import { create } from "zustand";

export type ViewMode = "split" | "rendered" | "source";

interface ViewModeState {
  modes: Record<string, ViewMode>;
  setMode: (tabId: string, mode: ViewMode) => void;
}

const useViewModeStore = create<ViewModeState>((set) => ({
  modes: {},
  setMode: (tabId, mode) => set((s) => ({ modes: { ...s.modes, [tabId]: mode } })),
}));

export function useViewMode(tabId: string): ViewMode {
  return useViewModeStore((s) => s.modes[tabId] ?? "split");
}

interface Props {
  tabId: string;
}

const CYCLE: ViewMode[] = ["split", "rendered", "source"];

const ICONS: Record<ViewMode, typeof Columns2> = {
  split: Columns2,
  rendered: Eye,
  source: FileText,
};

const LABELS: Record<ViewMode, string> = {
  split: "Split view",
  rendered: "Preview only",
  source: "Source only",
};

export function ViewModeToggle({ tabId }: Props) {
  const mode = useViewMode(tabId);
  const setMode = useViewModeStore((s) => s.setMode);

  function cycle() {
    const idx = CYCLE.indexOf(mode);
    setMode(tabId, CYCLE[(idx + 1) % CYCLE.length] as ViewMode);
  }

  const Icon = ICONS[mode];

  return (
    <Button variant="ghost" size="icon" onClick={cycle} title={LABELS[mode]} className="h-7 w-7">
      <Icon className="h-4 w-4" />
    </Button>
  );
}

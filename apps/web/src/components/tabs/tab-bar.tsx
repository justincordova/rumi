import { apiFetch } from "@/lib/api";
import { PLAN_LIMITS, type PlanKey } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { useSubscriptionStore } from "@/stores/subscription";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Role, TabSummary } from "@rumi/protocol";
import type { CreateTabResponse } from "@rumi/protocol";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AddTabPopover } from "./add-tab-popover";
import { getTabIcon } from "./tab-icons";

interface Props {
  tabs: TabSummary[];
  activeTabId: string | undefined;
  roomSlug: string;
  onSelect: (tabId: string) => void;
  isGuest?: boolean;
  role?: Role | null;
}

export function TabBar({ tabs, activeTabId, roomSlug, onSelect, isGuest, role }: Props) {
  // Read the user's plan from the subscription store so the cap matches what
  // the server enforces. The server is source of truth; this is just the UI
  // affordance gate (showing or hiding the popover at limit).
  const plan = useSubscriptionStore((s) => (s.subscription?.plan ?? "free") as PlanKey);
  const tabCap = PLAN_LIMITS[plan].maxTabsPerRoom;
  const atCap = tabs.length >= tabCap;
  const canManageTabs = role === "owner" || role === "admin";

  // Local optimistic order for drag-and-drop. We mirror the parent-supplied
  // tabs and only diverge briefly during a drag; once the server broadcast
  // arrives via the control doc, the parent's `tabs` prop is the source of
  // truth again.
  const [optimistic, setOptimistic] = useState<TabSummary[] | null>(null);
  const tabsToRender = optimistic ?? tabs;

  // Reset optimistic state once the parent prop reflects the new order
  // (or any further tab list change).
  useEffect(() => {
    if (!optimistic) return;
    const sameOrder =
      optimistic.length === tabs.length && optimistic.every((t, i) => t.id === tabs[i]?.id);
    if (sameOrder) setOptimistic(null);
  }, [tabs, optimistic]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function addTab(type: "tab" | "drawing") {
    try {
      await apiFetch<CreateTabResponse>(`/api/rooms/${roomSlug}/tabs`, {
        method: "POST",
        body: { type },
      });
      // New tab id propagates via control doc observe; no manual state update needed.
    } catch (err: unknown) {
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't create tab");
    }
  }

  function notifyAtCap() {
    toast.message(`You've hit the ${tabCap}-tab limit`, {
      description:
        plan === "max"
          ? "This is the maximum tabs per room."
          : "Upgrade your account to create more tabs in this room.",
    });
  }

  async function closeTab(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    try {
      await apiFetch(`/api/rooms/${roomSlug}/tabs/${tabId}`, { method: "DELETE" });
    } catch (err: unknown) {
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't delete tab");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabsToRender.findIndex((t) => t.id === active.id);
    const newIndex = tabsToRender.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) {
      toast.info("Tab list changed during drag — try again");
      return;
    }
    const next = arrayMove(tabsToRender, oldIndex, newIndex);
    setOptimistic(next);
    try {
      await apiFetch(`/api/rooms/${roomSlug}/tabs/reorder`, {
        method: "POST",
        body: { tabIds: next.map((t) => t.id) },
      });
      // Clear optimistic state on success so the server broadcast (or any
      // concurrent reorder by another admin) becomes the source of truth on
      // the next render. Without this, a concurrent reorder that produces a
      // different final order would be hidden by our stale optimistic state.
      setOptimistic(null);
    } catch (err: unknown) {
      setOptimistic(null);
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't reorder tabs");
    }
  }

  const tabIds = tabsToRender.map((t) => t.id);

  return (
    <div className="flex-none border-b border-border bg-background shrink-0">
      <div className="flex items-end gap-1 px-2 pt-1.5">
        <div
          // Scroll affordance: a right-edge gradient scrim hints there's more
          // content when the strip overflows. Pure CSS — only renders on
          // narrow widths where overflow is likely.
          className="relative flex min-w-0 flex-1 items-end gap-1 overflow-x-auto after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-6 after:bg-gradient-to-l after:from-background after:to-transparent sm:after:hidden"
          role="tablist"
          aria-label="Open tabs"
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
              {tabsToRender.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <SortableTabItem
                    key={tab.id}
                    tab={tab}
                    isActive={isActive}
                    roomSlug={roomSlug}
                    onSelect={onSelect}
                    onClose={closeTab}
                    canClose={tabsToRender.length > 1 && canManageTabs}
                    isGuest={isGuest}
                    canRename={canManageTabs}
                    canDrag={!!canManageTabs}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
          {!isGuest && canManageTabs && (
            <div className="mb-0.5">
              <AddTabPopover onAdd={addTab} atCap={atCap} onAtCapClick={notifyAtCap} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableTabItem(props: TabItemProps & { canDrag: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.tab.id,
    disabled: !props.canDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(props.canDrag ? attributes : {})}
      {...(props.canDrag ? listeners : {})}
    >
      <TabItem {...props} />
    </div>
  );
}

interface TabItemProps {
  tab: TabSummary;
  isActive: boolean;
  roomSlug: string;
  onSelect: (tabId: string) => void;
  onClose: (e: React.MouseEvent, tabId: string) => void;
  canClose: boolean;
  isGuest?: boolean;
  canRename?: boolean;
}

function TabItem({
  tab,
  isActive,
  roomSlug,
  onSelect,
  onClose,
  canClose,
  isGuest,
  canRename,
}: TabItemProps) {
  const Icon = getTabIcon(tab.type, tab.language);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter handler calls commit(); setEditing(false) unmounts the input which
  // fires onBlur → commit() again. Guard prevents the duplicate PATCH.
  const committingRef = useRef(false);

  useEffect(() => {
    setDraft(tab.name);
  }, [tab.name]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      committingRef.current = false;
    }
  }, [editing]);

  async function commit() {
    if (committingRef.current) return;
    committingRef.current = true;
    const next = draft.trim() || "Untitled";
    if (next !== tab.name) {
      try {
        await apiFetch(`/api/rooms/${roomSlug}/tabs/${tab.id}`, {
          method: "PATCH",
          body: { name: next },
        });
      } catch {
        setDraft(tab.name);
      }
    }
    setEditing(false);
  }

  return (
    <div
      role="tab"
      tabIndex={0}
      onClick={() => !editing && onSelect(tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(tab.id);
      }}
      aria-selected={isActive}
      className={cn(
        "group relative flex h-9 max-w-[200px] min-w-[120px] cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-3 text-[13px] transition-all",
        isActive
          ? "border-border bg-background text-foreground shadow-xs"
          : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-colors",
          isActive ? "text-primary" : "text-muted-foreground",
        )}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(tab.name);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none"
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate font-medium"
          onDoubleClick={
            canRename
              ? (e) => {
                  e.stopPropagation();
                  setEditing(true);
                }
              : undefined
          }
        >
          {tab.name}
        </span>
      )}
      {canClose && !isGuest && (
        <button
          type="button"
          onClick={(e) => onClose(e, tab.id)}
          className={cn(
            "grid h-4 w-4 place-items-center rounded-sm text-muted-foreground transition-all hover:bg-border-strong hover:text-foreground shrink-0",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          title="Close tab"
          aria-label={`Close ${tab.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {isActive && <span className="absolute -bottom-px left-2 right-2 h-px bg-background" />}
    </div>
  );
}

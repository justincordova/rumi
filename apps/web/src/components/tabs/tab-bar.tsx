import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { TabSummary } from "@rumi/protocol";
import type { CreateTabResponse } from "@rumi/protocol";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AddTabPopover } from "./add-tab-popover";
import { getTabIcon } from "./tab-icons";

const TAB_CAP = 3;

interface Props {
  tabs: TabSummary[];
  activeTabId: string | undefined;
  roomSlug: string;
  onSelect: (tabId: string) => void;
  isGuest?: boolean;
}

export function TabBar({ tabs, activeTabId, roomSlug, onSelect, isGuest }: Props) {
  const atCap = tabs.length >= TAB_CAP;

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
    toast.message(`You've hit the ${TAB_CAP}-tab limit`, {
      description: "Upgrade your account to create more tabs in this room.",
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

  return (
    <div className="flex-none border-b border-border bg-background shrink-0">
      <div className="flex items-end gap-1 px-2 pt-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const _Icon = getTabIcon(tab.type, tab.language);
            return (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={isActive}
                roomSlug={roomSlug}
                onSelect={onSelect}
                onClose={closeTab}
                canClose={tabs.length > 1}
                isGuest={isGuest}
              />
            );
          })}
          {!isGuest && (
            <div className="mb-0.5">
              <AddTabPopover onAdd={addTab} atCap={atCap} onAtCapClick={notifyAtCap} />
            </div>
          )}
        </div>
      </div>
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
}

function TabItem({ tab, isActive, roomSlug, onSelect, onClose, canClose, isGuest }: TabItemProps) {
  const Icon = getTabIcon(tab.type, tab.language);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(tab.name);
  }, [tab.name]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function commit() {
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
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
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
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {isActive && <span className="absolute -bottom-px left-2 right-2 h-px bg-background" />}
    </div>
  );
}

import { bindCursorPresence } from "@/lib/drawing/cursor-presence";
import { DrawingGrid, type GridStyle } from "@/lib/drawing/grid";
import { useTldrawTheme } from "@/lib/drawing/theme";
import { createYjsStore } from "@/lib/drawing/yjs-store";
import { exportDrawingTab } from "@/lib/export-tab";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Role, TabSummary } from "@rumi/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Editor, type TLUiOverrides, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import type * as Y from "yjs";
import { EditorSkeleton } from "./editor-skeleton";
import { ExportMenu } from "./export-menu";
import { ReadOnlyPill } from "./read-only-pill";
import { useTabDoc } from "./use-tab-doc";

type GridState = "off" | GridStyle;

// Y.Map key used to persist the background/grid setting in the tab doc.
const BACKGROUND_KEY = "background";

const uiOverrides: TLUiOverrides = {
  actions(_editor, actions) {
    for (const key of Object.keys(actions)) {
      if (key.includes("debug")) delete actions[key];
    }
    return actions;
  },
};

export default function DrawingTab({ tab, role }: { tab: TabSummary; role?: Role | null }) {
  const { ydoc, provider, readOnly } = useTabDoc({ tabId: tab.id });
  if (!ydoc || !provider) return <EditorSkeleton />;
  return (
    <DrawingTabInner tab={tab} ydoc={ydoc} provider={provider} readOnly={readOnly} role={role} />
  );
}

interface InnerProps {
  tab: TabSummary;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  readOnly: boolean;
  role?: Role | null;
}

function DrawingTabInner({ tab, ydoc, provider, readOnly, role }: InnerProps) {
  const { theme } = useTldrawTheme();
  const editorRef = useRef<Editor | null>(null);
  const canManageBackground = role === "owner" || role === "admin";

  // Grid/background state is persisted in a Y.Map<string> on the tab doc so
  // that all users see the same background and it survives page reloads.
  const backgroundMap = useMemo(() => ydoc.getMap<string>(BACKGROUND_KEY), [ydoc]);

  const [gridState, setGridStateLocal] = useState<GridState>(
    () => (backgroundMap.get("grid") as GridState | undefined) ?? "lines",
  );

  // Subscribe to remote background changes so every client stays in sync.
  useEffect(() => {
    const observer = () => {
      const next = (backgroundMap.get("grid") as GridState | undefined) ?? "lines";
      setGridStateLocal(next);
    };
    backgroundMap.observe(observer);
    // Read current value immediately in case it changed while we were mounting.
    observer();
    return () => backgroundMap.unobserve(observer);
  }, [backgroundMap]);

  // Propagate to the editor whenever gridState changes.
  // (This also fires for remote changes via the observer above.)

  const setGridState = useCallback(
    (next: GridState) => {
      if (!canManageBackground) return;
      // Write to Yjs — the observer will update local state for all clients.
      ydoc.transact(() => {
        backgroundMap.set("grid", next);
      });
    },
    [canManageBackground, ydoc, backgroundMap],
  );

  const { store, bind } = useMemo(() => {
    return createYjsStore({ doc: ydoc });
  }, [ydoc]);

  const [synced, setSynced] = useState(() => provider.synced);
  useEffect(() => {
    if (provider.synced) {
      setSynced(true);
      return;
    }
    const onSynced = ({ state }: { state: boolean }) => {
      if (state) setSynced(true);
    };
    provider.on("synced", onSynced);
    return () => {
      provider.off("synced", onSynced);
    };
  }, [provider]);

  useEffect(() => {
    return () => store.dispose();
  }, [store]);

  useEffect(() => {
    editorRef.current?.user.updateUserPreferences({ colorScheme: theme });
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateInstanceState({ isReadonly: readOnly });
  }, [readOnly]);

  useEffect(() => {
    editorRef.current?.updateInstanceState({
      isGridMode: gridState !== "off",
    });
  }, [gridState]);

  const exportPng = useCallback(async () => {
    if (!editorRef.current) return;
    try {
      await exportDrawingTab(editorRef.current, tab, "png");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export drawing");
    }
  }, [tab]);

  const exportSvg = useCallback(async () => {
    if (!editorRef.current) return;
    try {
      await exportDrawingTab(editorRef.current, tab, "svg");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't export drawing");
    }
  }, [tab]);

  const tldrawComponents = useMemo(
    () => ({
      DebugPanel: null,
      DebugMenu: null,
      Minimap: null,
      Grid: (props: { size: number; x: number; y: number; z: number }) => (
        <DrawingGrid {...props} style={gridState === "dots" ? "dots" : "lines"} />
      ),
      InFrontOfTheCanvas: () => (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            pointerEvents: "auto",
          }}
          className="flex items-center gap-2"
        >
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface/90 backdrop-blur-sm p-0.5">
            <ExportMenu
              options={[
                { label: "Export as PNG", onSelect: exportPng },
                { label: "Export as SVG", onSelect: exportSvg },
              ]}
            />
          </div>
          {canManageBackground ? (
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface/90 backdrop-blur-sm p-0.5">
              <GridButton
                active={gridState === "off"}
                onClick={() => setGridState("off")}
                title="No grid"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  role="img"
                  aria-label="No grid"
                >
                  <path
                    d="M4.5 0v14M9.5 0v14M0 4.5h14M0 9.5h14"
                    stroke="currentColor"
                    strokeWidth="0.75"
                    opacity="0.35"
                  />
                  <path
                    d="M2 12L12 2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </GridButton>
              <GridButton
                active={gridState === "lines"}
                onClick={() => setGridState("lines")}
                title="Line grid"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  role="img"
                  aria-label="Line grid"
                >
                  <path
                    d="M4.5 0v14M9.5 0v14M0 4.5h14M0 9.5h14"
                    stroke="currentColor"
                    strokeWidth="0.75"
                  />
                </svg>
              </GridButton>
              <GridButton
                active={gridState === "dots"}
                onClick={() => setGridState("dots")}
                title="Dot grid"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="currentColor"
                  role="img"
                  aria-label="Dot grid"
                >
                  <circle cx="4.5" cy="4.5" r="1" />
                  <circle cx="9.5" cy="4.5" r="1" />
                  <circle cx="4.5" cy="9.5" r="1" />
                  <circle cx="9.5" cy="9.5" r="1" />
                </svg>
              </GridButton>
            </div>
          ) : null}
        </div>
      ),
    }),
    [gridState, canManageBackground, setGridState, exportPng, exportSvg],
  );

  if (!synced) return <EditorSkeleton />;

  return (
    <div className="relative h-full">
      <Tldraw
        store={store}
        autoFocus
        inferDarkMode={false}
        components={tldrawComponents}
        overrides={uiOverrides}
        options={{ maxPages: 1, maxShapesPerPage: 1000 }}
        onMount={(editor) => {
          editorRef.current = editor;
          editor.user.updateUserPreferences({ colorScheme: theme });
          editor.updateInstanceState({
            isReadonly: readOnly,
            isGridMode: gridState !== "off",
          });
          editor.setCameraOptions({
            constraints: {
              bounds: { x: -1000, y: -1000, w: 2000, h: 2000 },
              padding: { x: 50, y: 50 },
              origin: { x: 0.5, y: 0.5 },
              initialZoom: "fit-min",
              baseZoom: "default",
              behavior: "contain",
            },
            zoomSteps: [0.25, 0.5, 1, 2, 4],
          });
          const unbindStore = bind(editor);
          const unbindCursors = bindCursorPresence({ editor, provider, readOnly });
          return () => {
            unbindCursors();
            unbindStore();
          };
        }}
      />
      {readOnly && <ReadOnlyPill />}
    </div>
  );
}

function GridButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}
    >
      {children}
    </button>
  );
}

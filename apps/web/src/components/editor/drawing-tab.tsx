import { useTldrawTheme } from "@/lib/drawing/theme";
import { createYjsStore } from "@/lib/drawing/yjs-store";
import type { TabSummary } from "@rumi/protocol";
import { useEffect, useMemo, useRef } from "react";
import { type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import type * as Y from "yjs";
import { EditorSkeleton } from "./editor-skeleton";
import { ReadOnlyPill } from "./read-only-pill";
import { useTabDoc } from "./use-tab-doc";

// Asset uploads are not supported in MVP — tldraw v4 handles assets differently.
// External image drops will gracefully fail.

export default function DrawingTab({ tab }: { tab: TabSummary }) {
  const { ydoc, provider, readOnly } = useTabDoc({ tabId: tab.id });
  if (!ydoc || !provider) return <EditorSkeleton />;
  return <DrawingTabInner ydoc={ydoc} readOnly={readOnly} />;
}

interface InnerProps {
  ydoc: Y.Doc;
  readOnly: boolean;
}

function DrawingTabInner({ ydoc, readOnly }: InnerProps) {
  const { theme } = useTldrawTheme();
  const editorRef = useRef<Editor | null>(null);

  // Build a fresh TLStore + Yjs binding pair for this ydoc. `bind` is invoked
  // from `Tldraw.onMount` once the Editor has taken ownership of the store.
  const { store, bind } = useMemo(() => {
    return createYjsStore({ doc: ydoc });
  }, [ydoc]);

  // Cleanup the store when the tab unmounts.
  useEffect(() => {
    return () => store.dispose();
  }, [store]);

  // Push theme into tldraw whenever it changes mid-session.
  useEffect(() => {
    editorRef.current?.user.updateUserPreferences({ colorScheme: theme });
  }, [theme]);

  // Push readOnly into tldraw whenever it changes.
  useEffect(() => {
    editorRef.current?.updateInstanceState({ isReadonly: readOnly });
  }, [readOnly]);

  return (
    <div className="relative h-full">
      <Tldraw
        store={store}
        autoFocus
        inferDarkMode={false}
        onMount={(editor) => {
          editorRef.current = editor;
          editor.user.updateUserPreferences({ colorScheme: theme });
          editor.updateInstanceState({ isReadonly: readOnly });
          // Attach the local-change listener now that the Editor owns the store.
          // tldraw calls the function returned from onMount on unmount/teardown.
          return bind(editor);
        }}
      />
      {readOnly && <ReadOnlyPill />}
    </div>
  );
}

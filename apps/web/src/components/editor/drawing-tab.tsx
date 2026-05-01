import { useTldrawTheme } from "@/lib/drawing/theme";
import { createYjsStore } from "@/lib/drawing/yjs-store";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { TabSummary } from "@rumi/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
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
  return <DrawingTabInner ydoc={ydoc} provider={provider} readOnly={readOnly} />;
}

interface InnerProps {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  readOnly: boolean;
}

function DrawingTabInner({ ydoc, provider, readOnly }: InnerProps) {
  const { theme } = useTldrawTheme();
  const editorRef = useRef<Editor | null>(null);

  // Build the TLStore + Yjs binding once per ydoc. The `bind` returned here
  // is only safe to call AFTER the provider's initial sync completes — see
  // the comment in `yjs-store.ts` for why.
  const { store, bind } = useMemo(() => {
    return createYjsStore({ doc: ydoc });
  }, [ydoc]);

  // Wait for the HocuspocusProvider to finish its initial sync before we
  // mount tldraw. If we mount earlier and call `bind()` immediately, the
  // freshly-created TLStore's local default records (document, instance,
  // page) get written into the Y.Doc and clobber the persisted state from
  // the server — which is what made drawings vanish on refresh.
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

  if (!synced) return <EditorSkeleton />;

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

import type { Role, TabSummary } from "@rumi/protocol";
import { Suspense, lazy } from "react";
import { CodeTab } from "./code-tab";
import { EditorSkeleton } from "./editor-skeleton";
import { MarkdownTab } from "./markdown-tab";
import { useTabDoc } from "./use-tab-doc";

// Lazy-load the drawing tab — pulls tldraw's large bundle only when used.
const DrawingTab = lazy(() => import("./drawing-tab"));

export function TabEditor({
  tab,
  roomSlug,
  role,
}: { tab: TabSummary; roomSlug: string; role?: Role | null }) {
  if (tab.type === "drawing") {
    return (
      <Suspense fallback={<EditorSkeleton />}>
        <DrawingTab tab={tab} role={role} />
      </Suspense>
    );
  }

  return <TabEditorInner tab={tab} roomSlug={roomSlug} />;
}

// Separate component so hooks are called unconditionally.
function TabEditorInner({ tab, roomSlug }: { tab: TabSummary; roomSlug: string }) {
  const { ydoc, provider, readOnly } = useTabDoc({ tabId: tab.id });
  if (!ydoc || !provider) return <EditorSkeleton />;

  if (tab.language === "markdown") {
    return (
      <MarkdownTab
        ydoc={ydoc}
        provider={provider}
        tab={tab}
        readOnly={readOnly}
        roomSlug={roomSlug}
      />
    );
  }
  return (
    <CodeTab ydoc={ydoc} provider={provider} tab={tab} readOnly={readOnly} roomSlug={roomSlug} />
  );
}

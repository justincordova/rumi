import { Button } from "@/components/ui/button";
import { type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { useEffect, useRef } from "react";

export default function SandboxDrawing() {
  const editorRef = useRef<Editor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes();
    for (const s of shapes) {
      editor.deleteShape(s.id);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let savedY = 0;
    let blocked = false;
    let timer: ReturnType<typeof setTimeout>;

    const onDown = () => {
      savedY = window.scrollY;
      blocked = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        blocked = false;
      }, 300);
    };

    const onScroll = () => {
      if (blocked) window.scrollTo(0, savedY);
    };

    el.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll);

    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-[550px] rounded-xl border border-border bg-surface overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Drawing</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={reset}>
          Clear
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <Tldraw
          autoFocus={false}
          options={{ maxPages: 1 }}
          onMount={(editor) => {
            editorRef.current = editor;
            editor.setCameraOptions({ isLocked: true });
          }}
        />
      </div>
    </div>
  );
}

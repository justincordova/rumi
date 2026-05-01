import { Button } from "@/components/ui/button";
import { type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { useRef } from "react";

export default function SandboxDrawing() {
  const editorRef = useRef<Editor | null>(null);

  const reset = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes();
    for (const s of shapes) {
      editor.deleteShape(s.id);
    }
  };

  return (
    <div className="flex flex-col h-[550px] rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Drawing</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={reset}>
          Clear
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <Tldraw
          autoFocus={false}
          onMount={(editor) => {
            editorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}

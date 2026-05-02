import { useLayoutEffect, useRef } from "react";
import { useEditor, useIsDarkMode, useValue } from "tldraw";

export type GridStyle = "dots" | "lines";

interface DrawingGridProps {
  size: number;
  x: number;
  y: number;
  z: number;
  style: GridStyle;
}

export function DrawingGrid({ size, x, y, z, style }: DrawingGridProps) {
  const editor = useEditor();
  const screenBounds = useValue("screenBounds", () => editor.getViewportScreenBounds(), [editor]);
  const dpr = useValue("dpr", () => editor.getInstanceState().devicePixelRatio, [editor]);
  const isDark = useIsDarkMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = screenBounds.w * dpr;
    const h = screenBounds.h * dpr;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    const pageBounds = editor.getViewportPageBounds();
    const startX = Math.floor(pageBounds.minX / size) * size;
    const startY = Math.floor(pageBounds.minY / size) * size;
    const endX = Math.ceil(pageBounds.maxX / size) * size;
    const endY = Math.ceil(pageBounds.maxY / size) * size;

    if (style === "dots") {
      const color = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
      const radius = Math.max(1 * dpr, 1.5 * dpr * Math.min(z, 2));
      ctx.fillStyle = color;
      for (let px = startX; px <= endX; px += size) {
        for (let py = startY; py <= endY; py += size) {
          const cx = (px + x) * z * dpr;
          const cy = (py + y) * z * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      const color = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
      ctx.strokeStyle = color;
      ctx.lineWidth = dpr;
      for (let px = startX; px <= endX; px += size) {
        const cx = (px + x) * z * dpr;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();
      }
      for (let py = startY; py <= endY; py += size) {
        const cy = (py + y) * z * dpr;
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();
      }
    }
  }, [screenBounds, size, x, y, z, dpr, isDark, style, editor]);

  return <canvas className="tl-grid" ref={canvasRef} />;
}

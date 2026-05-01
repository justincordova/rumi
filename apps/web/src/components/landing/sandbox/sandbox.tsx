import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, lazy, useEffect, useRef, useState } from "react";

const SandboxMarkdown = lazy(() => import("./sandbox-markdown"));
const SandboxDrawing = lazy(() => import("./sandbox-drawing"));

function SandboxSkeleton() {
  return (
    <>
      <div className="flex flex-col h-[400px] rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border px-3 py-1.5">
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex-1 grid grid-cols-2 divide-x divide-border">
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
      <div className="flex flex-col h-[400px] rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border px-3 py-1.5">
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex-1" />
      </div>
    </>
  );
}

export function Sandbox() {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setReady(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="sandbox" ref={ref} className="mx-auto max-w-6xl px-6 pt-4 pb-16">
      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-bold tracking-tight">Try it yourself</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This is a single-user preview. Sign up to collaborate in real time.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {ready ? (
          <Suspense fallback={<SandboxSkeleton />}>
            <SandboxMarkdown />
            <SandboxDrawing />
          </Suspense>
        ) : (
          <SandboxSkeleton />
        )}
      </div>
    </section>
  );
}

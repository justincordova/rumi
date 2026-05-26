import { initAuth } from "@/lib/auth";
import { initSentry } from "@/lib/sentry";
import { supabase } from "@/lib/supabase";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./styles/fonts.css";
import "./styles/globals.css";

// Initialize Sentry as early as possible. No-op when VITE_SENTRY_DSN is unset.
initSentry();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

async function bootstrap(root: HTMLElement) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    // A bad/expired code throws here. Previously that prevented initAuth()
    // from running and left the entire app stuck in status: "loading" — every
    // protected route's beforeLoad checks for "anonymous" so the user never
    // got redirected and stared at a blank screen.
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      // fall through to initAuth() so the app boots in anonymous mode
    }
    params.delete("code");
    const clean = params.toString();
    const next = window.location.pathname + (clean ? `?${clean}` : "");
    window.history.replaceState(null, "", next);
  }

  await initAuth();

  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

bootstrap(rootElement);

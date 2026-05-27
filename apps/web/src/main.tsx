import { initAuth } from "@/lib/auth";
import { Sentry, initSentry } from "@/lib/sentry";
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
    // got redirected and stared at a blank screen. Capture to Sentry so the
    // recovery isn't completely silent.
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch (err) {
      Sentry.captureException(err, { tags: { area: "oauth-exchange" } });
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

// Top-level await rejection would surface as an unhandled rejection AND
// prevent React from ever mounting (no error UI, blank screen). Catch and
// render the router anyway so the user at least sees the landing page.
bootstrap(rootElement).catch((err) => {
  console.error("bootstrap failed", err);
  Sentry.captureException(err, { tags: { area: "bootstrap" } });
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});

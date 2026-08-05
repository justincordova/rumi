import { env } from "@/lib/env";
import * as Sentry from "@sentry/react";

let initialized = false;

/** Initialize Sentry. No-op when VITE_SENTRY_DSN is unset (dev/test). */
export function initSentry(): void {
  if (initialized) return;
  if (!env.VITE_SENTRY_DSN) return;

  Sentry.init({
    dsn: env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user?.email) event.user.email = "<redacted>";
      // Drop the query string from the captured URL. Sentry's httpContext
      // integration fills `request.url` from `location.href`, and
      // `bootstrap()` in main.tsx captures the OAuth exchange failure BEFORE
      // it strips `?code=` from the address bar — so the PKCE authorization
      // code would otherwise be transmitted to, and retained by, the error
      // backend. Mirrors the same scrub in the server's beforeSend.
      if (event.request?.url?.includes("?")) {
        event.request.url = event.request.url.split("?")[0];
      }
      if (event.request?.query_string) event.request.query_string = "<redacted>";
      if (event.request?.headers) {
        // biome-ignore lint/performance/noDelete: scrubbing PII; clearing the key is the intent
        delete event.request.headers.authorization;
        // biome-ignore lint/performance/noDelete: scrubbing PII; clearing the key is the intent
        delete event.request.headers.Authorization;
        // biome-ignore lint/performance/noDelete: scrubbing PII; clearing the key is the intent
        delete event.request.headers.cookie;
        // biome-ignore lint/performance/noDelete: scrubbing PII; clearing the key is the intent
        delete event.request.headers.Cookie;
      }
      return event;
    },
  });
  initialized = true;
}

export { Sentry };

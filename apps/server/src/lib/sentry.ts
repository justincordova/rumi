import { env } from "@/lib/env";
import * as Sentry from "@sentry/node";

let initialized = false;

/** Initialize Sentry. No-op when SENTRY_DSN is unset (dev/test). */
export function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip authorization headers and email-like fields from breadcrumbs
      // and request payloads.
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
      if (event.user?.email) event.user.email = "<redacted>";
      if (event.contexts?.runtime?.email) event.contexts.runtime.email = "<redacted>";
      // Drop request body entirely on auth/billing routes
      const url = event.request?.url ?? "";
      if (
        event.request?.data &&
        (url.includes("/api/billing") || url.includes("/api/auth") || url.includes("/auth"))
      ) {
        event.request.data = "<redacted>";
      }
      // The unsubscribe endpoint puts the HMAC token in the query string.
      // Strip the query so a captured Sentry event can't be replayed to
      // unsubscribe the affected user. (Body is still scrubbed by our other
      // rules above when posted via form-encoded.)
      if (event.request?.url?.includes("/api/notifications/unsubscribe")) {
        event.request.url = event.request.url.split("?")[0];
        if (event.request.query_string) event.request.query_string = "<redacted>";
      }
      return event;
    },
  });
  initialized = true;
}

export { Sentry };

import { AuthError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { type AuthenticatedUser, verifyJwt } from "./verify";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

// Public/optional-auth routes matched against the ROUTE PATTERN
// (`req.routeOptions.url`), not the raw request URL. Raw-URL regexes broke in
// two ways: query strings made patterns miss (e.g. `GET /api/rooms/slug?x=1`
// flipped from optional-auth to required-auth), and static sibling routes
// were captured by parametric patterns (`/api/rooms/trash` matched the
// `[a-z0-9-]+` slug pattern, reaching a handler that assumes `req.user`).
// Routing runs before onRequest in Fastify, so routeOptions is available.
const PUBLIC_ROUTES: ReadonlyArray<{ method: string; route: string; optional: boolean }> = [
  // GET /api/rooms/:slug — try to read Bearer but continue anonymously on failure
  { method: "GET", route: "/api/rooms/:slug", optional: true },
  // POST /api/billing/webhook — fully public; Stripe signature is the auth
  { method: "POST", route: "/api/billing/webhook", optional: false },
  // POST /api/notifications/unsubscribe — public; HMAC-signed token replaces JWT
  { method: "POST", route: "/api/notifications/unsubscribe", optional: false },
  // GET /api/notifications/unsubscribe — public confirmation page for the
  // in-body email link; the button POSTs to the route above
  { method: "GET", route: "/api/notifications/unsubscribe", optional: false },
];

const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, _reply) => {
    if (!req.url.startsWith("/api/")) return;

    const routeUrl = req.routeOptions?.url;
    const matched = routeUrl
      ? PUBLIC_ROUTES.find((r) => r.method === req.method && r.route === routeUrl)
      : undefined;

    // Fully public — skip auth entirely (webhook uses Stripe signature instead)
    if (matched && !matched.optional) return;

    // Optional auth — try to read Bearer but don't require it
    const isOptional = matched !== undefined;

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      if (isOptional) return;
      throw new AuthError("unauthorized", "Missing Authorization header");
    }
    try {
      req.user = await verifyJwt(auth.slice("Bearer ".length));
    } catch (err) {
      if (isOptional) {
        logger.debug({ err, url: req.url }, "optional auth failed, continuing anonymously");
        return;
      }
      throw err;
    }
  });
};

export default fp(authPlugin, { name: "auth" });

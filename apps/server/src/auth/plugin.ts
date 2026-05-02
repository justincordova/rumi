import { AuthError, envelope } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { type AuthenticatedUser, verifyJwt } from "./verify";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

const PUBLIC_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp; optional: boolean }> = [
  // GET /api/rooms/:slug — try to read Bearer but continue anonymously on failure
  { method: "GET", pattern: /^\/api\/rooms\/[a-z0-9-]+$/, optional: true },
  // POST /api/billing/webhook — fully public; Stripe signature is the auth
  { method: "POST", pattern: /^\/api\/billing\/webhook$/, optional: false },
  // POST /api/notifications/unsubscribe — public; HMAC-signed token replaces JWT
  { method: "POST", pattern: /^\/api\/notifications\/unsubscribe/, optional: false },
];

const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, _reply) => {
    if (!req.url.startsWith("/api/")) return;

    const matched = PUBLIC_ROUTES.find((r) => r.method === req.method && r.pattern.test(req.url));

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

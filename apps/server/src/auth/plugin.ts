import { AuthError, envelope } from "@/lib/errors";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { type AuthenticatedUser, verifyJwt } from "./verify";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

const OPTIONAL_AUTH_RE = /^\/api\/rooms\/[a-z0-9-]+$/;

const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;

    const isOptional = req.method === "GET" && OPTIONAL_AUTH_RE.test(req.url);

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      if (isOptional) return;
      const err = new AuthError("unauthorized", "Missing Authorization header");
      return reply.code(err.statusCode).send(envelope(err));
    }
    try {
      req.user = await verifyJwt(auth.slice("Bearer ".length));
    } catch (err) {
      if (isOptional) return;
      if (err instanceof AuthError) {
        return reply.code(err.statusCode).send(envelope(err));
      }
      throw err;
    }
  });
};

export default fp(authPlugin, { name: "auth" });

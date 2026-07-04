import { env } from "@/lib/env";
import { AppError, AuthError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { jwtVerify } from "jose";
import { JWKS } from "./jwks";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function verifyJwt(token: string): Promise<AuthenticatedUser> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.SUPABASE_JWT_ISSUER,
      audience: env.SUPABASE_JWT_AUDIENCE,
      // Pin the allowed algorithms. Supabase JWTs are ES256 (asymmetric key
      // signed via JWKS). Without this allowlist, jose would accept any
      // algorithm advertised on the JWK, including a hypothetical symmetric
      // key if the JWKS were ever misconfigured to expose one. Belt + braces.
      algorithms: ["ES256", "RS256"],
    });
    if (!payload.sub || typeof payload.email !== "string") {
      throw new AuthError("unauthorized", "JWT missing required claims");
    }
    return { id: payload.sub, email: payload.email.toLowerCase() };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // JWKS fetch failures (timeout, network) are OUR outage, not a bad token.
    // Returning 401 would tell every user to re-authenticate — and hide the
    // incident from logs entirely. Surface as 503 and log the cause.
    // ERR_JWKS_TIMEOUT is jose's remote-fetch timeout; a TypeError is the
    // fetch network failure surfaced through jose's remote JWKS loader.
    // (Checked via the `code` property rather than `jose.errors` classes so
    // test mocks of the jose module don't need to export them.)
    // biome-ignore lint/suspicious/noExplicitAny: jose errors carry a string code
    if ((err as any)?.code === "ERR_JWKS_TIMEOUT" || err instanceof TypeError) {
      logger.error({ err }, "jwks fetch failed during jwt verification");
      throw new AppError("server_error", "Authentication temporarily unavailable", 503);
    }
    logger.debug({ err }, "jwt verification rejected token");
    throw new AuthError("unauthorized", "Invalid or expired token");
  }
}

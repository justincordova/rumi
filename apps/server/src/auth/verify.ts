import { env } from "@/lib/env";
import { AuthError } from "@/lib/errors";
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
    throw new AuthError("unauthorized", "Invalid or expired token");
  }
}

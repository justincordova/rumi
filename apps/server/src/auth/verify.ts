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

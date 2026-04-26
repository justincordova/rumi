import { AppError } from "@/lib/errors";

/**
 * Verify a Supabase-issued JWT and return the user identity.
 *
 * Stub: real implementation lands with the auth feature plan. SPEC.md commits
 * to this contract; feature plans depend on the function existing.
 */
export async function verifySupabaseJwt(_token: string): Promise<never> {
  throw new AppError("verifySupabaseJwt not implemented", 501);
}

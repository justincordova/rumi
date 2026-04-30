import { z } from "zod";

export const ErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "slug_taken",
  "invite_not_found",
  "tab_limit_reached",
  "last_tab",
  "server_error",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

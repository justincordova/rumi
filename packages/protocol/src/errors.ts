import { z } from "zod";

export const ErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "slug_taken",
  "invite_not_found",
  "tab_limit_reached",
  "plan_limit_reached",
  "room_limit",
  "last_tab",
  "server_error",
  "stripe_not_configured",
  "no_stripe_customer",
  "webhook_signature_invalid",
  "invalid_plan",
  "invalid_state",
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

import { z } from "zod";

export const UpdateAccountBody = z.object({
  displayName: z.string().trim().min(1).max(80),
});
export type UpdateAccountBody = z.infer<typeof UpdateAccountBody>;

export const UpdateAccountResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
  }),
});
export type UpdateAccountResponse = z.infer<typeof UpdateAccountResponse>;

/**
 * Returned when the user owns rooms with other members. The frontend should
 * surface the list and ask the user to transfer ownership before retrying.
 */
export const DeleteAccountBlockedResponse = z.object({
  error: z.object({
    code: z.literal("ownership_transfer_required"),
    message: z.string(),
    rooms: z.array(
      z.object({
        slug: z.string(),
        name: z.string().nullable(),
      }),
    ),
  }),
});
export type DeleteAccountBlockedResponse = z.infer<typeof DeleteAccountBlockedResponse>;

export const DeleteAccountResponse = z.object({
  signedOut: z.boolean(),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;

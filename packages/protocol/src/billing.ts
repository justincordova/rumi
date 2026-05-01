import { z } from "zod";

export const CheckoutBody = z.object({
  plan: z.enum(["pro", "max"]),
  interval: z.enum(["monthly", "yearly"]),
});
export type CheckoutBody = z.infer<typeof CheckoutBody>;

export const EmbeddedCheckoutResponse = z.object({ clientSecret: z.string() });
export type EmbeddedCheckoutResponse = z.infer<typeof EmbeddedCheckoutResponse>;

export const PortalResponse = z.object({ url: z.string().url() });
export type PortalResponse = z.infer<typeof PortalResponse>;

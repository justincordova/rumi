import { ApiError, apiFetch } from "@/lib/api";
import { env } from "@/lib/env";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { EmbeddedCheckoutResponse } from "@rumi/protocol";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { X } from "lucide-react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

type Plan = "pro" | "max";
type Interval = "monthly" | "yearly";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan;
  interval: Interval;
}

// Lazy-load and cache the Stripe instance — only initialised if the key is set.
const stripePromise = env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

export function CheckoutModal({ open, onOpenChange, plan, interval }: Props) {
  if (!stripePromise) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150 overflow-hidden"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-[15px] font-semibold">
              Upgrade to {plan === "pro" ? "Pro" : "Max"}
            </span>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="max-h-[80vh] overflow-y-auto">
            {open && (
              <CheckoutForm
                stripePromise={stripePromise as StripePromise}
                plan={plan}
                interval={interval}
                onSuccess={() => onOpenChange(false)}
              />
            )}
          </div>

          <DialogPrimitive.Title className="sr-only">
            Upgrade to {plan === "pro" ? "Pro" : "Max"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Complete your subscription upgrade with Stripe.
          </DialogPrimitive.Description>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type StripePromise = ReturnType<typeof loadStripe>;

function CheckoutForm({
  stripePromise,
  plan,
  interval,
  onSuccess,
}: {
  stripePromise: StripePromise;
  plan: Plan;
  interval: Interval;
  onSuccess: () => void;
}) {
  // fetchedRef prevents double-firing in React strict mode.
  // A new useCallback identity (when plan/interval change) naturally resets the gate
  // because EmbeddedCheckoutProvider remounts when fetchClientSecret changes.
  const fetchedRef = useRef(false);

  const fetchClientSecret = useCallback(async () => {
    if (fetchedRef.current) return "";
    fetchedRef.current = true;
    try {
      const { clientSecret } = await apiFetch<EmbeddedCheckoutResponse>(
        "/api/billing/checkout/embedded",
        { method: "POST", body: { plan, interval } },
      );
      return clientSecret;
    } catch (err) {
      // Reset the gate so reopening the modal after a transient failure
      // re-attempts the request. Without this, fetchedRef stayed true
      // forever and Stripe's EmbeddedCheckout sat idle on retry.
      fetchedRef.current = false;
      if (err instanceof ApiError && err.code === "stripe_not_configured") {
        toast.info("Billing isn't enabled in this environment yet.");
      } else {
        toast.error("Couldn't start checkout. Please try again.");
      }
      return "";
    }
  }, [plan, interval]);

  return (
    <EmbeddedCheckoutProvider
      stripe={stripePromise}
      options={{
        fetchClientSecret,
        onComplete: onSuccess,
      }}
    >
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}

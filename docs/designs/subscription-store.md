# Subscription Zustand Store

## Context

Three components independently fetch `GET /api/subscriptions/me` with their own
`useState` + `useCallback` + polling logic:

- `components/topbar.tsx` — `PlanBadge` fetches on mount
- `components/landing/pricing-section.tsx` — fetches on mount
- `routes/_authed/settings.tsx` — `BillingTab` fetches on mount + polls after checkout

No other component can read the user's plan. The dashboard can't show room
counts against the cap. The room editor can't disable actions at limits.

## Design

### Store

`apps/web/src/stores/subscription.ts`

```ts
import type { Subscription } from "@rumi/protocol";

interface SubscriptionState {
  subscription: Subscription | null;
  status: "idle" | "loading" | "ready" | "error";
  fetch: () => Promise<Subscription | null>;
  pollUntilPlanChange: (fromPlan: string) => Promise<void>;
}
```

- `fetch()` — hits `/api/subscriptions/me`, sets `subscription` + `status`.
  Returns the data so callers can inspect it.
- `pollUntilPlanChange(fromPlan)` — polls with backoff (0, 750ms, 1.5s, 2.5s,
  4s) until `subscription.plan !== fromPlan` or timeout. Replaces the
  duplicated polling logic in topbar/settings/pricing-section.

No persistence — subscription state is always server-authoritative.

### Integration points

**Topbar `PlanBadge`**: replace local `useState` + `fetchPlan` with
`useSubscriptionStore`. Fetch on mount if `status === "idle"`. After checkout
modal closes, call `pollUntilPlanChange("free")`.

**Settings `BillingTab`**: replace local `useState` + `fetchSubscription` +
`pollForSubscriptionUpdate` with store. Keep the checkout-success toast logic
(via URL param).

**Pricing section**: replace local `useState` + `fetchPlan` + `pollForPlanUpdate`
with store.

### What gets deleted

- `fetchPlan`, `pollForPlanUpdate`, local `plan`/`setPlan` in `pricing-section.tsx`
- `fetchPlan`, `pollForPlanUpdate`, local `plan`/`setPlan` in `topbar.tsx`
- `fetchSubscription`, `pollForSubscriptionUpdate`, local `subscription`/`setSubscription` in `settings.tsx`
- All three become `useSubscriptionStore((s) => s.subscription)` + a single
  `useEffect` to fetch on mount.

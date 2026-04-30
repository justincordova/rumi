# Stripe Integration & Billing

## Context

The `subscriptions` table and `getUserPlan(userId)` helper are already in place from the pricing tiers work (`docs/designs/pricing-tiers.md`). The settings Billing tab and pricing cards exist as stubs (`docs/designs/settings-redesign.md`) — the upgrade buttons are disabled with a "Coming soon" tooltip. This doc wires Stripe behind those stubs so users can actually subscribe, manage, and have their plan reflected back into Rumi's enforcement points.

The schema is already Stripe-shaped: `stripeCustomerId`, `stripeSubscriptionId`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `status`, `trialEndsAt`. No schema migration is needed for the happy path.

## Goals

- Stripe Checkout for upgrades (Free → Pro / Max, monthly / annual)
- Stripe Customer Portal for cancellation, plan changes, payment method updates
- Webhook endpoint that mirrors subscription state into the `subscriptions` table
- "Manage subscription" button in the Billing tab that opens the Customer Portal
- Permission revocation on downgrade — drop active WS connections so enforcement re-evaluates
- Surface plan, status, and renewal/cancellation date in the Billing tab

## Non-Goals

- Team / per-seat billing (Pro and Max are individual plans only)
- Manual VAT / sales tax computation — handed off to Stripe Tax (see Stripe Tax under Design)
- Proration UI beyond what Stripe shows in Checkout / Portal
- In-app payment forms or saved-card display (Customer Portal owns this)
- Trial signup flow (we keep the schema field but don't expose a trial CTA)
- Coupons / promo codes in MVP
- Receipts / invoice history page in Rumi (Customer Portal already shows these)

## Design

### Stripe configuration

**Stripe Tax is enabled** at the account level. Adds `automatic_tax: { enabled: true }` to every Checkout Session. Stripe charges $0.50/transaction for automatic tax calculation. This handles EU VAT, UK VAT, US sales tax, and other regional regimes without hand-rolled logic. Customers see tax line-items in Checkout and on receipts.

Two products in Stripe — **Pro** and **Max** — each with two prices:

- `price_pro_monthly` — $8/mo
- `price_pro_yearly` — $80/yr
- `price_max_monthly` — $20/mo
- `price_max_yearly` — $200/yr

Price IDs are env-configured (`STRIPE_PRICE_PRO_MONTHLY`, etc.) so test/prod keys can point at different price objects.

Customer Portal is configured with:
- Allow plan switching between Pro and Max
- Allow billing cycle switching (monthly ↔ yearly) with proration
- Allow cancellation with `cancel_at_period_end = true`
- Show invoice history
- Update payment method

### Backend module

```
apps/server/src/billing/
  service.ts    — Stripe SDK wrapper: createCheckoutSession, createPortalSession, upsertSubscriptionFromEvent
  routes.ts     — POST /api/billing/checkout, POST /api/billing/portal, POST /api/billing/webhook
  webhook.ts    — Event router: maps Stripe event → service call
  plans.ts      — Map Stripe price ID → Rumi plan ('pro' | 'max') + interval
```

### Endpoints

**`POST /api/billing/checkout`** (auth required)

- Body: `{ plan: 'pro' | 'max', interval: 'monthly' | 'yearly' }`
- Looks up or creates a Stripe Customer for the user (cached in `subscriptions.stripeCustomerId`; creates on first call by storing the row with `plan: 'free'` so we have somewhere to put the customer id)
- Creates a Checkout Session with the corresponding price
- `success_url`: `${WEB_URL}/settings?tab=billing&checkout=success`
- `cancel_url`: `${WEB_URL}/settings?tab=billing&checkout=cancel`
- `mode: 'subscription'`
- `client_reference_id: userId` (for webhook fallback if customer lookup fails)
- `subscription_data.metadata: { userId }`
- `automatic_tax: { enabled: true }`
- `tax_id_collection: { enabled: true }` — lets business customers add a VAT ID for reverse-charge / B2B exemption
- Returns: `{ url: string }`

**`POST /api/billing/portal`** (auth required)

- Looks up `stripeCustomerId` for `req.user.id`
- Creates a Customer Portal session, `return_url: ${WEB_URL}/settings?tab=billing`
- Returns: `{ url: string }`
- 404 if no customer id (user never subscribed) — client falls back to checkout flow

**`POST /api/billing/webhook`** (no auth, raw body required)

- Verifies signature with `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEvent`
- Routes events to `upsertSubscriptionFromEvent`
- Returns 200 immediately on signature failure logging (Stripe retries on 5xx; we never return 5xx for valid signatures)

### Webhook event handling

Three events drive the entire flow:

| Event | Action |
|---|---|
| `checkout.session.completed` | Read `subscription` id from session; pull subscription via Stripe SDK; upsert row |
| `customer.subscription.updated` | Upsert all relevant fields (plan, status, period_end, cancel_at_period_end) |
| `customer.subscription.deleted` | Set `status = 'canceled'`, clear `stripe_subscription_id`, leave `cancelAtPeriodEnd` and `currentPeriodEnd` so `getUserPlan` correctly downgrades after the period ends |

`upsertSubscriptionFromEvent(event)`:

1. **Idempotency check:** look up `event.id` in `processed_webhook_events`. If present, return early (Stripe retried a delivery we already handled).
2. Resolve `userId` — first from `subscription.metadata.userId`, fallback to looking up `subscriptions` row by `stripeCustomerId`
3. Map `subscription.items.data[0].price.id` → `(plan, interval)` via `plans.ts`
4. Upsert row keyed by `userId`:
   - `plan`, `status`, `cancelAtPeriodEnd`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`, `trialEndsAt`
5. **If the plan changed (downgrade or cross-tier change):** call `app.dropUserConnections(userId)` to force WS reconnect. `enforceConnectionLimits` re-runs against the new plan on reconnect — owners over the new plan's caps get rejected gracefully via the existing `plan_limit_reached` path.
6. Insert `event.id` into `processed_webhook_events` in the same transaction as the subscription upsert. The whole handler is wrapped in a `db.transaction` so partial failure rolls back both the upsert and the event-id insert — Stripe retries safely.

### `processed_webhook_events` table

```ts
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Purges aren't needed at MVP scale (Stripe events are tiny strings). If the table grows, a periodic job can prune rows older than 90 days — Stripe doesn't retry past a few days anyway.

### Plan change → connection drop

`dropUserConnections(userId)` is a new Fastify decorator analogous to the existing `dropRoomConnections(roomId)`:

- Iterates all Hocuspocus documents
- For each, calls `connection.close()` on connections whose `context.user?.id === userId`
- Clients reconnect via `HocuspocusProvider`'s built-in retry; `enforceConnectionLimits` runs fresh

This handles the downgrade case where a Pro user with 6 rooms open downgrades to Free (3-room cap). The room rows aren't deleted — `getUserPlan` just stops them from creating new ones, and `enforceConnectionLimits` will reject WS auth on the 4th, 5th, 6th open rooms after reconnect. The user keeps access to their first 3 (alphabetical / connection-order — see Edge Cases).

### Frontend wiring

**Billing tab (`apps/web/src/routes/_authed/settings.tsx`):**

- Replace the disabled "Upgrade" buttons on Pro / Max cards with active handlers
- Add a billing-cycle toggle above the cards: "Monthly" / "Yearly (save 17%)"
- Click handler:
  ```ts
  async function upgrade(plan: 'pro' | 'max') {
    const { url } = await apiFetch('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan, interval }),
    });
    window.location.href = url;
  }
  ```
- "Current" card: show plan badge + status + renewal date ("Renews $date" or "Cancels $date" if `cancelAtPeriodEnd`)
- "Manage subscription" button (only when user has a non-free row): hits `/api/billing/portal` and redirects
- After redirect back from Checkout: parse `?checkout=success`, show toast, `getUserPlan` is server-authoritative so the next API call reflects the new plan; settings page refetches subscription on mount

**Account tab "Subscription" section** already exists from `settings-redesign.md` — wire its "Upgrade" / "Manage" buttons to the same handlers.

### Env vars

Server (`apps/server/.env`):
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_MAX_MONTHLY=price_...
STRIPE_PRICE_MAX_YEARLY=price_...
WEB_URL=http://localhost:5173
```

Add to the `env.ts` Zod schema. Default to a no-op stub when keys are missing so the dev environment doesn't require Stripe to run — the checkout endpoint can return 503 with a "Stripe not configured" error in that mode.

### Refund policy

**No refunds. Cancel anytime, access continues until period end.**

- Customer Portal exposes one-click cancellation, which sets `cancel_at_period_end = true`. The user keeps Pro/Max access until `current_period_end`, then `getUserPlan` downgrades them to Free.
- We do not process refunds via the Portal or Checkout. If a user contacts support requesting a refund, it's handled case-by-case via the Stripe dashboard — but this is not a documented entitlement.
- Documented in the ToS: "All sales are final. You may cancel your subscription at any time; access continues through the end of your current billing period. We do not provide refunds for unused time."
- Rationale: prevents the "use Pro for 13 days then refund" abuse pattern. Same model as Cursor, Linear, and most developer tooling. Cancellation flexibility (keep what you paid for through the period) is the user-friendly side of the policy.
- Stripe's dispute / chargeback flow remains unaffected — that's outside our refund policy and goes through Stripe's normal arbitration.

### Webhook in development

Stripe CLI: `stripe listen --forward-to localhost:8080/api/billing/webhook` — prints a signing secret to use as `STRIPE_WEBHOOK_SECRET` for the local session. Document this in `apps/server/README.md` (or a new `BILLING.md` if the README gets crowded).

### Webhook handler must read raw body

Fastify must skip JSON parsing for `/api/billing/webhook` because Stripe signature verification needs the raw bytes. Register a content-type parser that buffers raw body for that route, or use a route-level config:

```ts
fastify.register(async (instance) => {
  instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });
  instance.post('/webhook', { ... }, handler);
}, { prefix: '/api/billing' });
```

Document this clearly because it's an easy footgun.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Provider | Stripe | Industry standard; best docs, ecosystem, webhook tooling. LemonSqueezy is the alternative if merchant-of-record (auto VAT) becomes mandatory |
| Hosted vs embedded | Stripe Checkout (hosted) + Customer Portal | Zero PCI scope; no card form to build; handles tax, 3DS, dunning, receipts |
| Customer creation | On first checkout attempt | Avoids creating Stripe customers for users who never upgrade. We do persist a `subscriptions` row with `plan: 'free'` once the customer is created, just to anchor `stripeCustomerId` |
| Idempotency | `processed_webhook_events` table, transactional with the upsert | Strict idempotency from day one. Cheap (one extra insert per event); eliminates a class of duplicate-processing bugs that are hard to debug after the fact |
| Tax handling | Stripe Tax enabled | $0.50/transaction for automatic VAT/sales tax calculation. Cheap insurance against EU/UK exposure; eliminates a future refactor |
| Refunds | None — cancel anytime, access through period end | Prevents 13-day-then-refund abuse; matches Cursor/Linear; cancellation gives users the friendly side of the policy |
| Downgrade access | Drop connections, let enforcement reject reconnects | Reuses `enforceConnectionLimits` instead of building a separate downgrade-cleanup pass |
| Free-tier row | Created on first Stripe interaction | Free users with no Stripe activity stay row-less. Once they touch checkout, they get a row to anchor `stripeCustomerId` even if they cancel back to free |
| Trial UI | Schema supports it; no UI in MVP | Keeps the option open without committing to a trial-conversion flow |
| Promo codes | Deferred | Stripe supports them in Checkout via `allow_promotion_codes: true`; flip on when needed |
| Plan + interval mapping | Static map in `plans.ts` keyed by env-configured price IDs | Stripe price ids differ between test/prod; the map is the single source of truth |

## Rejected Alternatives

- **LemonSqueezy as primary** — better merchant-of-record story but smaller ecosystem; revisit only if EU VAT compliance forces it
- **Embedded Stripe Elements** — adds PCI scope and UI surface area we don't need
- **Building a custom billing UI in `/settings/billing`** — Customer Portal is free, well-tested, and handles edge cases (failed payments, dunning, refunds) we shouldn't reimplement
- **Polling subscription state from the client** — webhooks are the canonical source; polling is a fallback only if webhooks are missed
- **Per-seat / team plans** — explicit non-goal; revisit when we ship a Team tier

## Edge Cases & Constraints

- **Webhook arrives before checkout-success redirect** — the success page might re-fetch subscription; if `subscriptions` already shows the new plan, we just show the toast. If not, the redirect URL has `?checkout=success` so we can show the toast immediately and rely on the next page load.
- **Webhook never arrives** — manually retryable from the Stripe dashboard; in production we add a Sentry alert on webhook 5xx rates.
- **User downgrades from Pro (6 rooms) to Free (3-room cap)** — they keep all 6 room rows in the DB. `enforceConnectionLimits` only blocks NEW WS connections. Once they have 3 rooms open and try to open a 4th, they get the `plan_limit_reached` toast. Room creation also blocks at 3 (existing logic in `service.ts`). They can delete or downgrade back to fewer rooms; we don't auto-delete.
- **Owner downgrade affects guests** — concurrent-user limit reads the owner's plan, so an owner downgrade from Pro (15 concurrent) to Free (5 concurrent) immediately tightens the room cap. Already-connected users above the new limit stay connected (we don't kick); new joiners get rejected.
- **Failed payment (`status = 'past_due'`)** — `getUserPlan` treats `past_due` as active for the grace period (already implemented). Stripe's dunning handles the email retries; if it eventually fails to `canceled`, the next `customer.subscription.deleted` event fires and we downgrade.
- **Test vs prod keys** — every Stripe ID (price, webhook secret, customer) is environment-scoped. Document the test mode setup in the server README.
- **Webhook ordering** — Stripe doesn't guarantee event order. Our pure-upsert handlers are order-independent for `created`/`updated`, but `deleted` after `updated` is safe; `updated` arriving after `deleted` would re-create state. Mitigation: in the deleted handler, we don't clear `stripeSubscriptionId` if `currentPeriodEnd` is in the past — late `updated` events for an old subscription are no-ops. (Or: dedupe by `stripeSubscriptionId` + check the subscription's status in the event payload directly rather than blindly upserting.)
- **User changes email in Supabase** — Stripe customer email is set at creation and rarely updated. We can sync it in the webhook handler if it matters, but it doesn't affect billing.
- **User deletes Supabase account** — out of scope for this doc; deletion design lands when account-deletion endpoint ships. For now, the `subscriptions` row is orphaned; manual cleanup is fine at MVP scale.

## Pre-launch Checklist

Implementation-time verifications. Not design decisions — but easy to forget.

- [ ] **Stripe Customer Portal config:** confirm "Proration on change" is enabled (Stripe default). Affects mid-period plan switches and monthly↔yearly toggles.
- [ ] **Stripe Tax:** enabled at the account level + `automatic_tax: { enabled: true }` set on every Checkout Session.
- [ ] **Tax ID collection:** `tax_id_collection: { enabled: true }` set so business customers can provide VAT IDs.
- [ ] **Domain verification (Stripe):** required for Apple Pay / Google Pay in Checkout if we enable them; nice-to-have, not blocking.
- [ ] **Webhook signing secret:** rotated to prod value; `STRIPE_WEBHOOK_SECRET` set in prod env.
- [ ] **Price IDs in prod env vars:** `STRIPE_PRICE_PRO_MONTHLY`, etc. point at live-mode prices, not test prices.
- [ ] **Customer Portal allowed actions:** verify cancellation, plan switching (Pro ↔ Max), interval switching (monthly ↔ yearly), and update-payment-method are all enabled. Disable downgrade-to-free since we don't have a "free" Stripe price (free is the absence of a subscription, handled via cancellation).
- [ ] **Refund policy line in ToS:** copied verbatim from this doc into the public `/terms` page.
- [ ] **Test the downgrade path end-to-end:** subscribe to Pro → cancel → verify access continues until period end → verify `getUserPlan` flips to free after period end.
- [ ] **Test the connection-drop on plan change:** subscribe to Pro, open 4 rooms (Pro allows 25 but Free only 3), downgrade via webhook simulation, verify connections drop and the 4th room rejects on reconnect.
- [ ] **Webhook retry handling:** simulate duplicate webhook delivery and verify `processed_webhook_events` short-circuits the second handler.

## Open Questions

None — all resolved.

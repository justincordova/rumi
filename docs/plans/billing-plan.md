# Stripe Billing Plan

> **Goal:** Wire Stripe Checkout + Customer Portal behind the existing pricing/billing UI so users can upgrade, manage, and cancel subscriptions; mirror Stripe state into the `subscriptions` table via webhooks; force WS reconnects on plan change so `enforceConnectionLimits` re-evaluates.
> **Design doc:** `docs/designs/billing.md`

## Current state (verified against codebase)

What's already in place:
- `subscriptions` table with Stripe-shaped fields — `apps/server/src/db/schema.ts:76-91`
- `getUserPlan` + `PLAN_LIMITS` + `MAX_ROOMS_OPEN` — `apps/server/src/rooms/plan.ts`
- `GET /api/subscriptions/me` returning `{ subscription }` — `apps/server/src/subscriptions/routes.ts`
- `enforceConnectionLimits` is a function called from `onAuthenticate`, NOT a Fastify decorator — `apps/server/src/sync/connection-limits.ts:22`
- `dropRoomConnections` and `closeTabConnections` decorators exist; `dropUserConnections` does NOT — `apps/server/src/server.ts:61-75`, `apps/server/src/types.d.ts`
- Pricing cards live on a **separate `/upgrade` page**, not in the Billing settings tab — `apps/web/src/routes/_authed/upgrade.tsx`. The "Upgrade" buttons are `disabled` placeholders (line 135).
- Settings → Billing tab has `CurrentPlanSection`, `BillingHistorySection` (mocked invoices), `CancelPlanSection` (toast "Coming soon") — `apps/web/src/routes/_authed/settings.tsx:367-547`
- `DashboardDropdown` in topbar already routes "Upgrade" → `/upgrade` and "Billing" → `/settings?tab=billing` — `apps/web/src/components/topbar.tsx:189-198`
- No `billing/` server module, no Stripe SDK installed, no Stripe env vars in `apps/server/src/lib/env.ts`
- No `processed_webhook_events` table

The design doc was written assuming pricing cards lived in the Billing tab. They don't — they live on `/upgrade`. The plan reflects the actual layout: upgrade CTAs go on `/upgrade`, manage/cancel CTAs go in `/settings?tab=billing`.

## Phase 1: Backend — Stripe SDK, env, plans map, webhook events table

**Gate:** Stripe SDK installed, env vars validated, `processed_webhook_events` table migrated, `plans.ts` map exported.

### Task 1: Install Stripe SDK and add env vars

- **What:** Add `stripe` to `apps/server` dependencies; extend `env.ts` Zod schema with Stripe + `WEB_URL` keys.
- **Why:** Every later task imports the SDK and reads the env vars.
- **How:**
  - `bun add stripe` from `apps/server/`
  - Edit `apps/server/src/lib/env.ts` — add fields:
    ```ts
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PRO_YEARLY: z.string().optional(),
    STRIPE_PRICE_MAX_MONTHLY: z.string().optional(),
    STRIPE_PRICE_MAX_YEARLY: z.string().optional(),
    WEB_URL: z.string().url().default("http://localhost:5173"),
    ```
    All Stripe keys are `.optional()` so the dev environment runs without Stripe configured (the routes will return 503 in that mode). `WEB_URL` is the public web origin used in Checkout `success_url` / `cancel_url` and the Portal `return_url`. It can differ from `WEB_ORIGIN` (which is for CORS); document that in the env example.
  - Update `apps/server/.env.example` with all of the above.
- **Verify:** `bun run typecheck` passes; server boots with empty Stripe vars.

### Task 2: Add `processed_webhook_events` table

- **What:** New idempotency table tracking processed Stripe event IDs.
- **Why:** Stripe retries on 5xx and occasional duplicates; the table prevents double-processing.
- **How:**
  - Edit `apps/server/src/db/schema.ts` — append:
    ```ts
    export const processedWebhookEvents = pgTable("processed_webhook_events", {
      eventId: text("event_id").primaryKey(),
      eventType: text("event_type").notNull(),
      processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    });
    ```
  - `bunx --cwd apps/server drizzle-kit generate`
  - `bun --cwd apps/server run db:migrate`
- **Verify:** Migration file present; table exists in Supabase.

### Task 3: Add `plans.ts` map (price ID ↔ plan + interval)

- **What:** New `apps/server/src/billing/plans.ts` mapping configured price IDs to `(plan, interval)`.
- **Why:** Webhooks receive a price ID; the upsert needs to know which plan it represents. Price IDs differ between test/prod, so the mapping is env-driven.
- **How:**
  - Create the file:
    ```ts
    import { env } from "@/lib/env";

    export type Interval = "monthly" | "yearly";
    export type PaidPlan = "pro" | "max";

    interface PlanInfo {
      plan: PaidPlan;
      interval: Interval;
    }

    export function priceIdToPlan(priceId: string): PlanInfo | null {
      switch (priceId) {
        case env.STRIPE_PRICE_PRO_MONTHLY: return { plan: "pro", interval: "monthly" };
        case env.STRIPE_PRICE_PRO_YEARLY:  return { plan: "pro", interval: "yearly" };
        case env.STRIPE_PRICE_MAX_MONTHLY: return { plan: "max", interval: "monthly" };
        case env.STRIPE_PRICE_MAX_YEARLY:  return { plan: "max", interval: "yearly" };
        default: return null;
      }
    }

    export function planToPriceId(plan: PaidPlan, interval: Interval): string | null {
      if (plan === "pro" && interval === "monthly") return env.STRIPE_PRICE_PRO_MONTHLY ?? null;
      if (plan === "pro" && interval === "yearly")  return env.STRIPE_PRICE_PRO_YEARLY ?? null;
      if (plan === "max" && interval === "monthly") return env.STRIPE_PRICE_MAX_MONTHLY ?? null;
      if (plan === "max" && interval === "yearly")  return env.STRIPE_PRICE_MAX_YEARLY ?? null;
      return null;
    }
    ```
    Skip `undefined` keys defensively — `case env.STRIPE_PRICE_PRO_MONTHLY` matches `undefined` against `priceId`, which is never `undefined`, so it's safe.
- **Verify:** Imports compile.

### Task 4: Add Stripe singleton

- **What:** Lazy-initialized Stripe SDK client in `apps/server/src/billing/stripe.ts`.
- **Why:** Routes need a typed Stripe instance; centralizing it makes the "stub when keys missing" check single-sourced.
- **How:**
  ```ts
  import { env } from "@/lib/env";
  import Stripe from "stripe";

  let _stripe: Stripe | null = null;

  export function getStripe(): Stripe {
    if (!env.STRIPE_SECRET_KEY) {
      throw new AppError("stripe_not_configured", "Billing is not configured", 503);
    }
    if (!_stripe) {
      _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
        // Use the SDK's pinned latest version. Hardcoding a literal like
        // "2024-12-18.acacia" will fail typecheck once the SDK ships a newer
        // version (the literal is no longer assignable to Stripe.LatestApiVersion).
        apiVersion: Stripe.LATEST_API_VERSION ?? undefined,
      });
    }
    return _stripe;
  }

  export function isStripeConfigured(): boolean {
    return Boolean(env.STRIPE_SECRET_KEY);
  }
  ```
- **Verify:** Importing `getStripe` without `STRIPE_SECRET_KEY` throws the expected `AppError`. With the key set, no typecheck errors on `apiVersion`.

## Phase 2: Backend — Service, webhook handler, routes

**Gate:** Service methods + webhook handler tested; routes registered; raw-body parsing verified for the webhook route.

### Task 5: Add `ErrorCode` entries for billing

- **What:** Extend the `ErrorCode` Zod enum in `packages/protocol/src/errors.ts`.
- **Why:** `AppError.code` is typed against this Zod enum (verified: `packages/protocol/src/errors.ts:3-15` defines `ErrorCode` as `z.enum([...])`). Without adding new codes here, every `new AppError("stripe_not_configured", ...)` call fails typechecking.
- **How:**
  - Edit `packages/protocol/src/errors.ts` and append to the enum:
    ```ts
    "stripe_not_configured",
    "no_stripe_customer",
    "webhook_signature_invalid",
    "invalid_plan",
    "invalid_state",
    ```
    (Including `invalid_state` here — it's also referenced by the misc-deferred plan. One-time edit, multiple consumers.)
- **Verify:** `bun run typecheck` from root.

### Task 6: Create the billing service

- **What:** `apps/server/src/billing/service.ts` — one factory exporting `createCheckoutSession`, `createPortalSession`, `upsertSubscriptionFromEvent`, `findOrCreateStripeCustomer`.
- **Why:** Routes and the webhook handler should not call the Stripe SDK directly; the service is the seam for tests.
- **Pre-checks (verify before writing code):**
  - Confirm `req.user.email` is non-null on the auth shape — open `apps/server/src/auth/verify.ts` and inspect `AuthenticatedUser`. Existing routes use `req.user!.email` (e.g. `rooms/routes.ts:23`), so it should be there. If somehow optional, throw `validation_failed` early in `createCheckoutSession`.
  - In Stripe SDK 2025+, `subscription.current_period_end` may have moved onto `subscription.items.data[0].current_period_end`. The `upsertSubscriptionFromEvent` code below should fall back: `const periodEnd = sub.current_period_end ?? sub.items.data[0]?.current_period_end ?? null;`. Adapt at implementation time based on the installed SDK's types.
- **How:**
  - Create the file. Pseudocode (real impl uses Drizzle and the Stripe types):
    ```ts
    import { db } from "@/db/client";
    import { subscriptions, processedWebhookEvents } from "@/db/schema";
    import { env } from "@/lib/env";
    import { AppError } from "@/lib/errors";
    import { logger } from "@/lib/logger";
    import { eq } from "drizzle-orm";
    import type Stripe from "stripe";
    import { type PaidPlan, type Interval, planToPriceId, priceIdToPlan } from "./plans";
    import { getStripe } from "./stripe";

    export type BillingService = ReturnType<typeof createBillingService>;

    export function createBillingService() {
      return {
        async findOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
          // Lock the row to avoid the double-create race on rapid double-click.
          // Use a transaction so the SELECT FOR UPDATE + UPDATE/INSERT pair is atomic.
          // Pseudocode — concrete syntax is `tx.execute(sql\`SELECT ... FOR UPDATE\`)` etc.
          const existing = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.userId, userId),
          });
          if (existing?.stripeCustomerId) return existing.stripeCustomerId;

          const stripe = getStripe();
          const customer = await stripe.customers.create({
            email,
            metadata: { userId },
          });

          // Anchor the customer id with a free-plan row if none exists.
          if (existing) {
            await db.update(subscriptions)
              .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
              .where(eq(subscriptions.userId, userId));
          } else {
            await db.insert(subscriptions).values({
              userId,
              plan: "free",
              status: "active",
              stripeCustomerId: customer.id,
            });
          }
          return customer.id;
        },

        async createCheckoutSession(opts: {
          userId: string;
          email: string;
          plan: PaidPlan;
          interval: Interval;
        }): Promise<{ url: string }> {
          const priceId = planToPriceId(opts.plan, opts.interval);
          if (!priceId) throw new AppError("invalid_plan", "Plan/interval not configured", 400);

          const customerId = await this.findOrCreateStripeCustomer(opts.userId, opts.email);
          const stripe = getStripe();

          const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            line_items: [{ price: priceId, quantity: 1 }],
            client_reference_id: opts.userId,
            subscription_data: { metadata: { userId: opts.userId } },
            automatic_tax: { enabled: true },
            tax_id_collection: { enabled: true },
            success_url: `${env.WEB_URL}/settings?tab=billing&checkout=success`,
            cancel_url: `${env.WEB_URL}/settings?tab=billing&checkout=cancel`,
          });
          if (!session.url) throw new AppError("server_error", "Stripe did not return a session URL", 500);
          return { url: session.url };
        },

        async createPortalSession(opts: { userId: string }): Promise<{ url: string }> {
          const row = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.userId, opts.userId),
          });
          if (!row?.stripeCustomerId) {
            throw new AppError("no_stripe_customer", "No billing account found", 404);
          }
          const stripe = getStripe();
          const portal = await stripe.billingPortal.sessions.create({
            customer: row.stripeCustomerId,
            return_url: `${env.WEB_URL}/settings?tab=billing`,
          });
          return { url: portal.url };
        },

        async upsertSubscriptionFromEvent(event: Stripe.Event): Promise<{ planChanged: boolean; userId: string | null }> {
          // Wrap the whole thing in a transaction. Idempotency check + upsert + event-id insert.
          // Use INSERT ... ON CONFLICT DO NOTHING for the event-id row so two
          // concurrent deliveries don't both pass the early check, do all the
          // work, and then crash on the PK violation at the end.
          return db.transaction(async (tx) => {
            const dup = await tx.query.processedWebhookEvents.findFirst({
              where: eq(processedWebhookEvents.eventId, event.id),
            });
            if (dup) return { planChanged: false, userId: null };

            // Pull the subscription object from the event.
            // For checkout.session.completed → fetch via stripe.subscriptions.retrieve(session.subscription)
            // For customer.subscription.* → event.data.object IS the subscription
            const sub = await resolveSubscriptionFromEvent(event); // see below
            if (!sub) {
              await tx.insert(processedWebhookEvents).values({
                eventId: event.id, eventType: event.type,
              });
              return { planChanged: false, userId: null };
            }

            const userId = sub.metadata?.userId
              ?? (await tx.query.subscriptions.findFirst({
                where: eq(subscriptions.stripeCustomerId, sub.customer as string),
              }))?.userId;
            if (!userId) {
              logger.warn({ eventId: event.id, customer: sub.customer }, "webhook: cannot resolve userId");
              await tx.insert(processedWebhookEvents).values({
                eventId: event.id, eventType: event.type,
              });
              return { planChanged: false, userId: null };
            }

            const priceId = sub.items.data[0]?.price.id ?? null;
            const planInfo = priceId ? priceIdToPlan(priceId) : null;
            const before = await tx.query.subscriptions.findFirst({
              where: eq(subscriptions.userId, userId),
            });

            const next = {
              userId,
              plan: event.type === "customer.subscription.deleted"
                ? "free" as const
                : (planInfo?.plan ?? before?.plan ?? "free"),
              status: mapStripeStatus(sub.status),
              cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
              currentPeriodEnd: sub.current_period_end
                ? new Date(sub.current_period_end * 1000)
                : null,
              trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
              stripeCustomerId: sub.customer as string,
              stripeSubscriptionId: event.type === "customer.subscription.deleted"
                ? null
                : sub.id,
              updatedAt: new Date(),
            };

            await tx.insert(subscriptions)
              .values({ ...next, createdAt: new Date() })
              .onConflictDoUpdate({
                target: subscriptions.userId,
                set: { ...next },
              });

            await tx.insert(processedWebhookEvents)
              .values({ eventId: event.id, eventType: event.type })
              .onConflictDoNothing();

            const planChanged = before?.plan !== next.plan;
            return { planChanged, userId };
          });
        },
      };
    }
    ```
    `mapStripeStatus` collapses Stripe's broader status enum to ours (`active|past_due|canceled`):
    - `active` / `trialing` → `active`
    - `past_due` → `past_due`
    - `canceled` / `unpaid` / `incomplete_expired` → `canceled`
    - `incomplete` → `active` (waiting for payment) — getUserPlan will downgrade if no `currentPeriodEnd`
  - `resolveSubscriptionFromEvent(event)` lives in the same file:
    - `checkout.session.completed`: read `session.subscription` (string id) and call `stripe.subscriptions.retrieve(id)` to get the full object
    - `customer.subscription.created|updated|deleted`: cast `event.data.object` to `Stripe.Subscription`
    - Other event types: return `null`
- **Verify:** Add a test file `apps/server/src/billing/service.test.ts` that mocks `@/db/client` and `./stripe` and exercises:
  - Idempotency — same event id processed twice → second is a no-op
  - `customer.subscription.updated` upgrade Pro→Max → row updated, `planChanged: true`
  - `customer.subscription.deleted` → plan reset to `free`, `stripeSubscriptionId` cleared
  - Missing `userId` (no metadata, no customer match) → logged + event recorded, no upsert
  - Transaction rollback if either insert fails (mock the second call to throw, verify the first was rolled back)

### Task 7: Add `dropUserConnections` decorator

- **What:** New Fastify decorator analogous to `dropRoomConnections`.
- **Why:** On plan downgrade, drop all WS connections for the user so `enforceConnectionLimits` re-evaluates on reconnect.
- **How:**
  - Edit `apps/server/src/types.d.ts` — add `dropUserConnections: (userId: string) => void;`
  - Edit `apps/server/src/server.ts` — register:
    ```ts
    app.decorate("dropUserConnections", (userId: string) => {
      logger.debug({ userId }, "dropping user ws connections");
      for (const doc of hocuspocus.documents.values()) {
        for (const conn of doc.getConnections()) {
          // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
          const ctx = conn.context as any;
          if (ctx?.user?.id === userId) {
            try { conn.close(); } catch { /* ignore */ }
          }
        }
      }
    });
    ```
- **Verify:** `bun run typecheck`. Add a small unit test that mocks Hocuspocus' `documents` Map and verifies only matching connections are closed.

### Task 8: Add billing routes (checkout + portal)

- **What:** `apps/server/src/billing/routes.ts` exporting the two auth'd routes.
- **Why:** The web client calls these to start Checkout / Portal flows.
- **How:**
  ```ts
  // apps/server/src/billing/routes.ts
  import { AppError } from "@/lib/errors";
  import { CheckoutBody } from "@rumi/protocol";
  import type { FastifyPluginAsync } from "fastify";
  import type { ZodTypeProvider } from "fastify-type-provider-zod";
  import { z } from "zod";
  import { createBillingService } from "./service";
  import { isStripeConfigured } from "./stripe";

  export const billingRoutes: FastifyPluginAsync = async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const service = createBillingService();

    typed.post("/checkout", { schema: { body: CheckoutBody, response: { 200: z.object({ url: z.string() }) } } }, async (req) => {
      if (!isStripeConfigured()) throw new AppError("stripe_not_configured", "Billing not configured", 503);
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user
      const { id, email } = req.user!;
      return service.createCheckoutSession({ userId: id, email, plan: req.body.plan, interval: req.body.interval });
    });

    typed.post("/portal", { schema: { response: { 200: z.object({ url: z.string() }) } } }, async (req) => {
      if (!isStripeConfigured()) throw new AppError("stripe_not_configured", "Billing not configured", 503);
      // biome-ignore lint/style/noNonNullAssertion: auth plugin guarantees req.user
      return service.createPortalSession({ userId: req.user!.id });
    });
  };
  ```
- **Verify:** Add `apps/server/src/billing/routes.test.ts` covering: 503 when not configured, 401 without auth, 400 on invalid body, 404 from portal when no customer.

### Task 9a: Exempt the webhook URL from the global auth hook

- **What:** Update `apps/server/src/auth/plugin.ts` so `POST /api/billing/webhook` is not auth-gated.
- **Why:** **The auth plugin adds a global `onRequest` hook for ALL `/api/*` URLs** (verified at `apps/server/src/auth/plugin.ts:16-35`). Without an exemption, every Stripe delivery is rejected with 401 before the webhook handler runs. The current optional-auth gate is `req.method === "GET" && /^\/api\/rooms\/[a-z0-9-]+$/.test(req.url)` — neither condition matches the webhook (POST + different URL).
- **How:**
  - Replace the single `OPTIONAL_AUTH_RE` constant with an allowlist that supports method+URL pairs:
    ```ts
    const PUBLIC_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
      // GET /api/rooms/:slug — guest-readable rooms
      { method: "GET", pattern: /^\/api\/rooms\/[a-z0-9-]+$/ },
      // POST /api/billing/webhook — Stripe deliveries (signature-verified)
      { method: "POST", pattern: /^\/api\/billing\/webhook$/ },
    ];

    const isPublic = PUBLIC_ROUTES.some(
      (r) => r.method === req.method && r.pattern.test(req.url),
    );
    ```
  - For the webhook, treat the route as **fully public** (skip auth entirely — don't even attempt to read the Bearer token). The signature header is the auth.
  - For `GET /api/rooms/:slug`, keep the existing optional-auth behavior (try to read Bearer; on failure, continue anonymously).
- **Verify:** `curl -X POST localhost:3000/api/billing/webhook` returns the route's response (likely 400 for missing signature) — NOT 401. Existing `GET /api/rooms/:slug` anonymous access still works. Existing auth-required routes still 401 without a token.

### Task 9b: Add the webhook route with raw-body parsing

- **What:** Mount `/api/billing/webhook` in a sub-plugin that overrides JSON parsing to raw `Buffer`.
- **Why:** Stripe signature verification requires the raw bytes.
- **How:**
  - Add `apps/server/src/billing/webhook.ts`:
    ```ts
    import { env } from "@/lib/env";
    import { AppError } from "@/lib/errors";
    import { logger } from "@/lib/logger";
    import type { FastifyPluginAsync } from "fastify";
    import type Stripe from "stripe";
    import { createBillingService } from "./service";
    import { getStripe, isStripeConfigured } from "./stripe";

    export const webhookRoutes: FastifyPluginAsync = async (app) => {
      app.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_req, body, done) => done(null, body),
      );

      const service = createBillingService();

      app.post("/webhook", async (req, reply) => {
        if (!isStripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
          // Acknowledge so Stripe doesn't retry, but log loudly.
          logger.warn("webhook received but Stripe is not configured");
          return reply.code(200).send({ received: true });
        }
        const signature = req.headers["stripe-signature"];
        if (!signature || typeof signature !== "string") {
          throw new AppError("webhook_signature_invalid", "Missing signature", 400);
        }

        let event: Stripe.Event;
        try {
          event = getStripe().webhooks.constructEvent(
            req.body as Buffer,
            signature,
            env.STRIPE_WEBHOOK_SECRET,
          );
        } catch (err) {
          logger.warn({ err }, "webhook signature verification failed");
          // 400 — Stripe doesn't retry signature failures
          return reply.code(400).send({ error: "invalid_signature" });
        }

        // Only handle the three events that drive plan state.
        const handled = new Set([
          "checkout.session.completed",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ]);
        if (!handled.has(event.type)) {
          return reply.code(200).send({ received: true, ignored: true });
        }

        try {
          const result = await service.upsertSubscriptionFromEvent(event);
          if (result.planChanged && result.userId) {
            app.dropUserConnections(result.userId);
          }
          return reply.code(200).send({ received: true });
        } catch (err) {
          logger.error({ err, eventId: event.id }, "webhook handler failed");
          // Return 500 so Stripe retries — but only for genuinely unexpected errors.
          // The transaction in the service ensures partial failure rolls back, so
          // a retry will see the unprocessed event.
          return reply.code(500).send({ error: "handler_failed" });
        }
      });
    };
    ```
  - Edit `apps/server/src/server.ts` — register both billing route groups:
    ```ts
    await app.register(billingRoutes, { prefix: "/api/billing" });
    await app.register(webhookRoutes, { prefix: "/api/billing" });
    ```
    Fastify plugin encapsulation: the `addContentTypeParser` call inside `webhookRoutes` only affects that plugin and its descendants. Registering `billingRoutes` and `webhookRoutes` as sibling plugins under the same `/api/billing` prefix is safe — JSON parsing for `/checkout` and `/portal` is unchanged.
- **Verify:**
  - `apps/server/src/billing/webhook.test.ts` — boot a Fastify instance, fire a POST with a Stripe-signed payload (use `stripe.webhooks.generateTestHeaderString`), verify the service is called and `dropUserConnections` is called when plan changes.
  - 400 on bad signature; 200 on unhandled event types; 500 propagates handler errors.

### Task 10: Protocol schemas for billing

- **What:** `packages/protocol/src/billing.ts` with `CheckoutBody`, `CheckoutResponse`, `PortalResponse`.
- **Why:** Shared types between server route and web client.
- **How:**
  ```ts
  import { z } from "zod";

  export const CheckoutBody = z.object({
    plan: z.enum(["pro", "max"]),
    interval: z.enum(["monthly", "yearly"]),
  });
  export type CheckoutBody = z.infer<typeof CheckoutBody>;

  export const CheckoutResponse = z.object({ url: z.string().url() });
  export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

  export const PortalResponse = z.object({ url: z.string().url() });
  export type PortalResponse = z.infer<typeof PortalResponse>;
  ```
  Re-export from `packages/protocol/src/index.ts`.
- **Verify:** `bun run typecheck` from root.

## Phase 3: Frontend — wire upgrade + portal + cancel

**Gate:** Upgrade buttons fire Checkout, Manage button hits Portal, Cancel button uses Portal flow, success/cancel return URLs surface toasts.

### Task 11: Add billing-cycle toggle to `/upgrade` and wire Upgrade buttons

- **What:** Add a Monthly / Yearly (save 17%) toggle above the pricing cards in `apps/web/src/routes/_authed/upgrade.tsx`; wire each non-current plan's Upgrade button to call `/api/billing/checkout`.
- **Why:** The `/upgrade` page is the single CTA surface for new subscriptions.
- **How:**
  - Add a `useState<Interval>("monthly")` and a small toggle UI (segmented control / radio pair) above the grid.
  - Show prices that change with interval — for now use the static numbers from `pricing-tiers.md`:
    - Pro: $8/mo or $80/yr (16% effective annual savings, design says "save 17%" — round up in copy)
    - Max: $20/mo or $200/yr
  - Replace the disabled Upgrade buttons (line 131-138) with handlers:
    ```ts
    async function handleUpgrade(plan: "pro" | "max") {
      try {
        const { url } = await apiFetch<CheckoutResponse>("/api/billing/checkout", {
          method: "POST",
          body: { plan, interval },
        });
        window.location.href = url;
      } catch (err) {
        if (err.code === "stripe_not_configured") {
          toast.info("Billing isn't enabled in this environment yet.");
        } else {
          toast.error("Couldn't start checkout. Try again.");
        }
      }
    }
    ```
  - Keep the "Current plan" badge for the user's current tier; disable that card's button.
  - Read `?plan=pro|max` from the URL on mount — when present, pre-select that card visually (no auto-redirect; the user still clicks).
- **Verify:** Manual: click Upgrade → redirects to Stripe Checkout (test mode). The current-plan card stays disabled. Toggle interval → button still works.

### Task 12: Wire `/settings?tab=billing` Manage + Cancel to Portal

- **What:** Replace the toast "Coming soon" handlers in `BillingHistorySection` and `CancelPlanSection` with real Portal calls; replace mocked invoices with a "Manage billing" CTA.
- **Why:** The Customer Portal owns invoices, payment methods, and cancellation. We don't reimplement those in Rumi.
- **How:**
  - In `apps/web/src/routes/_authed/settings.tsx`:
    - Replace `BillingHistorySection` body with a single section: header "Billing" + "Open the Stripe billing portal to view invoices, update your payment method, or change plans." + "Manage billing" button.
    - The button calls:
      ```ts
      async function handlePortal() {
        try {
          const { url } = await apiFetch<PortalResponse>("/api/billing/portal", { method: "POST" });
          window.location.href = url;
        } catch (err) {
          if (err.code === "no_stripe_customer") {
            navigate({ to: "/upgrade" });
          } else {
            toast.error("Couldn't open billing portal. Try again.");
          }
        }
      }
      ```
    - Hide the section entirely if `subscription.plan === "free"` AND there's no `stripeCustomerId` we know about — for free users we just show "Upgrade for billing" link to `/upgrade`. Simplest signal: if `GET /api/subscriptions/me` returns `{ subscription: null }`, treat as never-subscribed; show "You're on the Free plan. <Upgrade>".
  - Replace `CancelPlanSection` "Cancel plan" action: also opens the Portal (cancellation is a Portal action). Remove the existing AlertDialog OR keep the dialog as a "you'll be redirected to Stripe to cancel" confirmation. Recommendation: keep the dialog so the copy still reassures the user; on confirm, call `handlePortal()`.
  - **Delete `MOCK_INVOICES`** and the table rendering it. The Portal owns invoice history.
- **Verify:** Free user sees the Upgrade nudge. Paid user clicks Manage → Stripe Portal opens. Cancel dialog confirm → Portal opens.

### Task 13: Surface checkout return-URL state

- **What:** Read `?checkout=success|cancel` from `/settings?tab=billing` and toast accordingly.
- **Why:** When the user returns from Checkout, give them feedback before the webhook lands (the webhook may already have, in which case the next refetch shows the new plan).
- **How:**
  - In `apps/web/src/routes/_authed/settings.tsx` (the file's top-level component), extend the route's `validateSearch` (currently `settingsTabSchema`) to also accept `checkout: z.enum(["success", "cancel"]).optional()`.
  - In `BillingTab`, on mount, read `useSearch()`:
    - `success` → `toast.success("Welcome to Pro!")` (or read the new plan and tailor); refetch `/api/subscriptions/me`; clear the param via `navigate({ to: "/settings", search: { tab: "billing" }, replace: true })`
    - `cancel` → `toast.info("Checkout canceled. You're still on the Free plan.")`; clear the param
  - Refresh the plan badge after success — easiest: refetch on mount, plus a one-shot retry 2s later in case the webhook is in flight.
- **Verify:** Manual end-to-end with Stripe test mode + `stripe listen --forward-to localhost:3000/api/billing/webhook`.

### Task 14: Update `useSession` / API error handling for `stripe_not_configured`

- **What:** Make `apiFetch` aware of the `stripe_not_configured` 503 so callers can show a friendly toast.
- **Why:** Dev environments without Stripe vars shouldn't 500 noisily; the UI should explain.
- **How:** No special code needed — the existing error envelope already exposes `code`. Callers in tasks 11+12 already branch on it. Spot-check `apps/web/src/lib/api.ts` to confirm 503 errors propagate the envelope rather than masking them as "network error."
- **Verify:** Dev without Stripe keys → clicking Upgrade shows the configured-toast; no console errors.

## Phase 4: Local dev story + docs

**Gate:** A new contributor can run Stripe webhooks locally without reading Stripe docs from scratch.

### Task 15: Document Stripe local dev setup

- **What:** Add a short `apps/server/BILLING.md` (or section in the server README) with the Stripe CLI flow.
- **Why:** Webhook signing secret is per-session in dev; without docs the next person spends a day on this.
- **How:**
  - Document:
    1. `stripe login`
    2. Create products + prices in test mode (or via `stripe prices create`); copy the price IDs into `.env`
    3. `stripe listen --forward-to localhost:3000/api/billing/webhook` — copy the printed `whsec_…` into `.env` as `STRIPE_WEBHOOK_SECRET`
    4. `stripe trigger checkout.session.completed` to test the handler
  - Cross-link from `AGENTS.md` "Further reading" section.
- **Verify:** A teammate can follow the doc and trigger a successful subscription on a fresh checkout.

### Task 16: Pre-launch checklist (manual verification)

Implementation-time, run these before flipping live keys:
- [ ] Stripe Tax enabled at the account level
- [ ] Customer Portal config: enable cancel, plan switch (Pro↔Max), interval switch (monthly↔yearly), update payment method
- [ ] Disable "downgrade to free" in Portal config (free is no subscription, handled via cancel)
- [ ] `STRIPE_PRICE_*` env vars point at live-mode prices in production
- [ ] `STRIPE_WEBHOOK_SECRET` rotated to the production webhook endpoint's secret
- [ ] Refund policy line copied verbatim into `/terms` (see misc-deferred plan)
- [ ] End-to-end test: subscribe to Pro → cancel → access continues until period end → `getUserPlan` flips to free after period end
- [ ] Connection-drop test: subscribe Pro, open 4 rooms, fire a `customer.subscription.updated` simulating downgrade to Free → connections drop, the 4th room rejects on reconnect with `plan_limit_reached`
- [ ] Webhook duplicate test: replay a delivered event from the Stripe dashboard → `processed_webhook_events` short-circuits the handler

## Phase 5: Pre-commit gate

`bun run check` → `bun run typecheck` → `bun test apps packages` → `vite build`. All must pass.

## Out of scope (deferred per design doc)

- Team / per-seat plans
- Trial signup CTA (schema field exists, no UI)
- Promo codes
- Receipts / invoice list inside Rumi
- Account deletion endpoint (separate design)
- Coupons in Checkout (`allow_promotion_codes`)

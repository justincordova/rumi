import { beforeEach, describe, expect, it, mock } from "bun:test";

// In-memory stand-in for the `subscriptions` and `processed_webhook_events`
// tables. Tests reset this between cases. The Drizzle stub below operates
// directly against these maps.
type SubRow = {
  userId: string;
  plan: "free" | "pro" | "max";
  status: "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const subs = new Map<string, SubRow>();
const processedEvents = new Map<string, { eventType: string }>();

// Stripe SDK stub.
const mockStripe = {
  subscriptions: {
    retrieve: mock(async (_id: string) => {
      throw new Error("not stubbed");
    }),
  },
  customers: {
    create: mock(async (_args: unknown) => ({ id: "cus_new" })),
  },
  checkout: {
    sessions: {
      create: mock(async (_args: unknown) => ({
        client_secret: "cs_test_secret",
      })),
    },
  },
  billingPortal: {
    sessions: {
      create: mock(async (_args: unknown) => ({ url: "https://portal.example/return" })),
    },
  },
};

mock.module("@/billing/stripe", () => ({
  getStripe: () => mockStripe,
  isStripeConfigured: () => true,
}));

// `mock.module` replaces the module globally and persists across test files.
// Must include every env field read elsewhere (e.g. SUPABASE_JWT_ISSUER read
// by `@/server`) — otherwise later tests importing the cached server module
// see undefined values via ESM live bindings.
mock.module("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    PORT: 3000,
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SUPABASE_JWKS_URL: "https://test.supabase.co/auth/v1/.well-known/jwks.json",
    SUPABASE_JWT_ISSUER: "https://test.supabase.co/auth/v1",
    SUPABASE_JWT_AUDIENCE: "authenticated",
    WEB_ORIGIN: "http://localhost:5173",
    WEB_URL: "http://localhost:5173",
    PUBLIC_API_URL: "http://localhost:3000",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
    STRIPE_PRICE_PRO_YEARLY: "price_pro_yearly",
    STRIPE_PRICE_MAX_MONTHLY: "price_max_monthly",
    STRIPE_PRICE_MAX_YEARLY: "price_max_yearly",
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
  },
}));

// Captures information about the active query so the where()/findFirst()
// stubs route to the right in-memory map. The service always calls eq() with
// the column reference as the first arg — we stash that via a sentinel and
// read it back inside the stub.
type Filter = { col: unknown; value: string };

// `mock.module` is GLOBAL in Bun and leaks across test files. Mocking shared
// modules with PARTIAL implementations (e.g. only eq/lte) would strip the other
// exports (`and`, `isNull`, `roomWhitelist`, ...) — or worse, feed a fake `eq`
// into a real `and` — in every server test that loads after this one, breaking
// CI non-deterministically (see the `0add619` env-mock fix for the same class).
//
// To stay leak-safe we spread the REAL modules and only wrap eq()/lte(): they
// still return a genuine Drizzle condition (so real `and`/`or` in other files
// keep working) with the `{ col, value }` routing info attached as extra
// own-properties that the in-memory stub DB below reads and real Drizzle
// ignores. Real schema tables are reused so column identity comparisons hold.
const realDrizzle = await import("drizzle-orm");
// Capture the real fns into locals BEFORE mocking — referencing `realDrizzle.eq`
// inside the factory would resolve through the live (now-mocked) binding and
// recurse infinitely.
const realDrizzleExports = { ...realDrizzle };
const realEq = realDrizzle.eq;
const realLte = realDrizzle.lte;
const schema = await import("@/db/schema");
const subsTable = schema.subscriptions;
const processedTable = schema.processedWebhookEvents;

const FILTER = Symbol("filter");

function wrapCondition(condition: unknown, col: unknown, value: unknown): unknown {
  if (typeof condition === "object" && condition !== null) {
    (condition as Record<symbol, Filter>)[FILTER] = { col, value: String(value) };
  }
  return condition;
}

mock.module("drizzle-orm", () => ({
  ...realDrizzleExports,
  eq: (col: unknown, value: unknown) => wrapCondition(realEq(col as never, value), col, value),
  lte: (col: unknown, value: unknown) => wrapCondition(realLte(col as never, value), col, value),
}));

function getFilter(x: unknown): Filter | null {
  if (typeof x === "object" && x !== null && FILTER in x) {
    return (x as Record<symbol, Filter>)[FILTER];
  }
  return null;
}

function selectByFilter(cond: unknown): SubRow | null {
  const filter = getFilter(cond);
  if (!filter) return null;
  if (filter.col === subsTable.userId) {
    return subs.get(filter.value) ?? null;
  }
  if (filter.col === subsTable.stripeCustomerId) {
    for (const row of subs.values()) {
      if (row.stripeCustomerId === filter.value) return row;
    }
    return null;
  }
  return null;
}

function selectProcessedByFilter(cond: unknown): { eventType: string } | null {
  const filter = getFilter(cond);
  if (!filter) return null;
  if (filter.col === processedTable.eventId) {
    return processedEvents.get(filter.value) ?? null;
  }
  return null;
}

function makeTx() {
  return {
    execute: async (_query: unknown) => undefined,
    select: () => ({
      from: (_table: unknown) => ({
        where: (cond: unknown) => ({
          for: async (_mode: string) => {
            const row = selectByFilter(cond);
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: SubRow | { eventId: string; eventType: string }) => {
        if (table === subsTable) {
          const row = values as SubRow;
          subs.set(row.userId, { ...row });
          return {
            onConflictDoUpdate: ({ set }: { set: Partial<SubRow> }) => {
              const existing = subs.get(row.userId);
              if (existing) subs.set(row.userId, { ...existing, ...set });
              return Promise.resolve();
            },
            onConflictDoNothing: () => Promise.resolve(),
          };
        }
        // processedWebhookEvents
        const ev = values as { eventId: string; eventType: string };
        return {
          onConflictDoNothing: () => {
            const isNew = !processedEvents.has(ev.eventId);
            if (isNew) {
              processedEvents.set(ev.eventId, { eventType: ev.eventType });
            }
            // Mirror Drizzle's chain: `.onConflictDoNothing().returning(...)`
            // returns an array of rows actually inserted (empty on conflict).
            // Used by the service for single-shot idempotency claim.
            const claimedRows = isNew ? [{ eventId: ev.eventId }] : [];
            return Object.assign(Promise.resolve(), {
              returning: () => Promise.resolve(claimedRows),
            });
          },
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: Partial<SubRow>) => ({
        where: async (cond: unknown) => {
          const filter = getFilter(cond);
          if (!filter || filter.col !== subsTable.userId) return;
          const existing = subs.get(filter.value);
          if (existing) subs.set(filter.value, { ...existing, ...patch });
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: async () => {},
    }),
    query: {
      subscriptions: {
        findFirst: async ({ where }: { where: unknown }) => {
          return selectByFilter(where);
        },
      },
      processedWebhookEvents: {
        findFirst: async ({ where }: { where: unknown }) => {
          return selectProcessedByFilter(where);
        },
      },
    },
  };
}

const stubDb = {
  ...makeTx(),
  transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>) => fn(makeTx()),
};

mock.module("@/db/client", () => ({
  db: stubDb,
  closeDb: async () => {},
}));

const { createBillingService } = await import("./service");

beforeEach(() => {
  subs.clear();
  processedEvents.clear();
  mockStripe.subscriptions.retrieve.mockReset();
  mockStripe.customers.create.mockReset();
  mockStripe.customers.create.mockImplementation(async () => ({ id: "cus_new" }));
  mockStripe.checkout.sessions.create.mockReset();
  mockStripe.checkout.sessions.create.mockImplementation(async () => ({
    client_secret: "cs_test_secret",
  }));
});

// Build a Stripe.Event-shaped payload. Only the fields the service touches.
function makeSubscriptionEvent(opts: {
  id?: string;
  type: "customer.subscription.updated" | "customer.subscription.deleted";
  subscriptionId?: string;
  customerId?: string;
  userId?: string | null;
  priceId?: string;
  status?: "active" | "past_due" | "canceled" | "incomplete_expired";
  cancelAtPeriodEnd?: boolean;
  currentPeriodEndSec?: number;
}) {
  const sub = {
    id: opts.subscriptionId ?? "sub_123",
    customer: opts.customerId ?? "cus_123",
    status: opts.status ?? "active",
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    trial_end: null,
    metadata:
      opts.userId === undefined
        ? { userId: "user_1" }
        : opts.userId === null
          ? {}
          : { userId: opts.userId },
    items: {
      data: [
        {
          price: { id: opts.priceId ?? "price_pro_monthly" },
          current_period_end:
            opts.currentPeriodEndSec ?? Math.floor(Date.now() / 1000) + 30 * 86400,
        },
      ],
    },
  };
  return {
    id: opts.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: opts.type,
    data: { object: sub },
  } as unknown as Parameters<
    ReturnType<typeof createBillingService>["upsertSubscriptionFromEvent"]
  >[0];
}

describe("billing service", () => {
  describe("upsertSubscriptionFromEvent — idempotency", () => {
    it("short-circuits on duplicate event id", async () => {
      const service = createBillingService();
      const event = makeSubscriptionEvent({ type: "customer.subscription.updated" });

      const first = await service.upsertSubscriptionFromEvent(event);
      const second = await service.upsertSubscriptionFromEvent(event);

      expect(first.userId).toBe("user_1");
      expect(first.planChanged).toBe(true);
      // Second call must short-circuit: no userId returned, no planChanged.
      expect(second.userId).toBeNull();
      expect(second.planChanged).toBe(false);
      expect(processedEvents.size).toBe(1);
    });
  });

  describe("upsertSubscriptionFromEvent — userId resolution", () => {
    it("falls back to customer-id lookup when subscription metadata is missing", async () => {
      // Pre-seed a subscriptions row so the customer-id lookup succeeds.
      subs.set("user_1", {
        userId: "user_1",
        plan: "free",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        trialEndsAt: null,
        stripeCustomerId: "cus_seeded",
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = createBillingService();
      const event = makeSubscriptionEvent({
        type: "customer.subscription.updated",
        userId: null, // no metadata
        customerId: "cus_seeded",
      });

      const result = await service.upsertSubscriptionFromEvent(event);

      expect(result.userId).toBe("user_1");
      expect(subs.get("user_1")?.plan).toBe("pro");
    });

    it("ignores event when userId cannot be resolved at all", async () => {
      const service = createBillingService();
      const event = makeSubscriptionEvent({
        type: "customer.subscription.updated",
        userId: null,
        customerId: "cus_unknown",
      });

      const result = await service.upsertSubscriptionFromEvent(event);
      expect(result.userId).toBeNull();
      expect(result.planChanged).toBe(false);
      // Still recorded so retries don't reprocess.
      expect(processedEvents.size).toBe(1);
    });
  });

  describe("upsertSubscriptionFromEvent — plan change detection", () => {
    it("reports planChanged when a free user upgrades to pro", async () => {
      const service = createBillingService();
      const event = makeSubscriptionEvent({ type: "customer.subscription.updated" });

      const result = await service.upsertSubscriptionFromEvent(event);

      expect(result.planChanged).toBe(true);
      expect(subs.get("user_1")?.plan).toBe("pro");
    });

    it("does not report planChanged when status changes but plan is the same", async () => {
      subs.set("user_1", {
        userId: "user_1",
        plan: "pro",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
        trialEndsAt: null,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = createBillingService();
      const event = makeSubscriptionEvent({
        type: "customer.subscription.updated",
        status: "past_due",
      });

      const result = await service.upsertSubscriptionFromEvent(event);

      expect(result.planChanged).toBe(false);
      expect(subs.get("user_1")?.status).toBe("past_due");
    });
  });

  describe("upsertSubscriptionFromEvent — deleted semantics", () => {
    it("preserves plan and currentPeriodEnd on customer.subscription.deleted", async () => {
      const periodEnd = new Date(Date.now() + 10 * 86400 * 1000);
      subs.set("user_1", {
        userId: "user_1",
        plan: "pro",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = createBillingService();
      const event = makeSubscriptionEvent({
        type: "customer.subscription.deleted",
        status: "canceled",
        currentPeriodEndSec: Math.floor(periodEnd.getTime() / 1000),
      });

      const result = await service.upsertSubscriptionFromEvent(event);

      // Plan stays paid so resolvePlan grants access until period end.
      expect(subs.get("user_1")?.plan).toBe("pro");
      expect(subs.get("user_1")?.status).toBe("canceled");
      expect(subs.get("user_1")?.cancelAtPeriodEnd).toBe(true);
      expect(subs.get("user_1")?.stripeSubscriptionId).toBeNull();
      // No plan change → no connection drop.
      expect(result.planChanged).toBe(false);
    });
  });

  describe("upsertSubscriptionFromEvent — out-of-order protection", () => {
    it("ignores a late update for a canceled subscription", async () => {
      subs.set("user_1", {
        userId: "user_1",
        plan: "pro",
        status: "canceled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() - 86400 * 1000), // already past
        trialEndsAt: null,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null, // already cleared by deleted handler
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = createBillingService();
      const lateEvent = makeSubscriptionEvent({
        type: "customer.subscription.updated",
        status: "canceled",
      });

      const result = await service.upsertSubscriptionFromEvent(lateEvent);

      expect(result.planChanged).toBe(false);
      // Row is untouched — stripeSubscriptionId stays null.
      expect(subs.get("user_1")?.stripeSubscriptionId).toBeNull();
      expect(subs.get("user_1")?.status).toBe("canceled");
    });

    it("does not suppress an update with status=active for a new subscription", async () => {
      // User canceled previously, then re-subscribed. The new subscription
      // arrives with status=active and a new stripeSubscriptionId. Must NOT
      // be suppressed by the late-update guard.
      subs.set("user_1", {
        userId: "user_1",
        plan: "pro",
        status: "canceled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() - 86400 * 1000),
        trialEndsAt: null,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = createBillingService();
      const event = makeSubscriptionEvent({
        type: "customer.subscription.updated",
        subscriptionId: "sub_new",
        status: "active",
      });

      const result = await service.upsertSubscriptionFromEvent(event);

      expect(subs.get("user_1")?.stripeSubscriptionId).toBe("sub_new");
      expect(subs.get("user_1")?.status).toBe("active");
      // plan was already pro, so no planChanged
      expect(result.planChanged).toBe(false);
    });
  });

  describe("findOrCreateStripeCustomer", () => {
    it("creates a Stripe customer + subscriptions row on first call", async () => {
      const service = createBillingService();

      const id = await service.findOrCreateStripeCustomer("user_1", "u@x.com");

      expect(id).toBe("cus_new");
      expect(mockStripe.customers.create).toHaveBeenCalledTimes(1);
      expect(subs.get("user_1")?.stripeCustomerId).toBe("cus_new");
    });

    it("returns the existing customer id without calling Stripe a second time", async () => {
      subs.set("user_1", {
        userId: "user_1",
        plan: "free",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        trialEndsAt: null,
        stripeCustomerId: "cus_existing",
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const service = createBillingService();
      const id = await service.findOrCreateStripeCustomer("user_1", "u@x.com");

      expect(id).toBe("cus_existing");
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
    });
  });

  describe("createEmbeddedCheckoutSession", () => {
    function seedSub(over: Partial<SubRow> = {}) {
      subs.set("user_1", {
        userId: "user_1",
        plan: "pro",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
        trialEndsAt: null,
        stripeCustomerId: "cus_existing",
        stripeSubscriptionId: "sub_live",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      });
    }

    it("refuses to open a second checkout for a live subscription", async () => {
      seedSub();
      const service = createBillingService();

      await expect(
        service.createEmbeddedCheckoutSession({
          userId: "user_1",
          email: "u@x.com",
          plan: "max",
          interval: "monthly",
        }),
      ).rejects.toThrow(/already have an active subscription/i);

      // Never reached Stripe — no duplicate subscription can be created.
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("allows re-subscribing after the subscription was deleted", async () => {
      // `customer.subscription.deleted` nulls stripeSubscriptionId and sets
      // status='canceled'; there is no live Stripe subscription to double up.
      seedSub({ status: "canceled", stripeSubscriptionId: null });
      const service = createBillingService();

      const { clientSecret } = await service.createEmbeddedCheckoutSession({
        userId: "user_1",
        email: "u@x.com",
        plan: "pro",
        interval: "monthly",
      });

      expect(clientSecret).toBe("cs_test_secret");
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it("allows a first-time subscriber with no row", async () => {
      const service = createBillingService();

      const { clientSecret } = await service.createEmbeddedCheckoutSession({
        userId: "user_1",
        email: "u@x.com",
        plan: "pro",
        interval: "monthly",
      });

      expect(clientSecret).toBe("cs_test_secret");
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });
  });
});

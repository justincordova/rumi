import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

const dropUserConnections = mock((_userId: string) => {});

// Tracks calls to the upsert handler so we can assert idempotency at the
// route layer (handler short-circuits via the service when the eventId is
// duplicate, but here we just verify the route invokes the service correctly).
const upsertCalls: { eventId: string }[] = [];

mock.module("@/billing/service", () => ({
  createBillingService: () => ({
    upsertSubscriptionFromEvent: async (event: { id: string }) => {
      upsertCalls.push({ eventId: event.id });
      return { planChanged: true, userId: "user_1" };
    },
  }),
}));

// Stripe webhook signature verification stub — accepts a fixed "good"
// signature and rejects everything else, mimicking the real SDK contract
// without requiring a real key.
const constructEventAsync = mock(async (body: Buffer, signature: string, _secret: string) => {
  if (signature !== "valid_signature") {
    throw new Error("Invalid signature");
  }
  return JSON.parse(body.toString("utf8"));
});

mock.module("@/billing/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEventAsync },
  }),
  isStripeConfigured: () => true,
}));

// `mock.module` replaces the module globally and persists across test files.
// Must include every env field read elsewhere — otherwise later tests
// importing the cached server module see undefined values via ESM live bindings.
mock.module("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    PORT: 3000,
    DATABASE_URL: "postgres://localhost/test",
    SUPABASE_JWKS_URL: "https://example.com/.well-known/jwks.json",
    SUPABASE_JWT_ISSUER: "https://example.com",
    SUPABASE_JWT_AUDIENCE: "authenticated",
    WEB_ORIGIN: "http://localhost:5173",
    WEB_URL: "http://localhost:5173",
    PUBLIC_API_URL: "http://localhost:3000",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
  },
}));

mock.module("jose", () => ({
  createRemoteJWKSet: mock(() => "mock-jwks"),
  jwtVerify: mock(async () => ({
    payload: { sub: "user-id", email: "user@example.com" },
  })),
}));

mock.module("@hocuspocus/extension-database", () => ({
  Database: class {},
}));

const { buildServer } = await import("@/server");

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  // Replace the real dropUserConnections decorator with our spy.
  // @ts-expect-error — overriding a Fastify decorator at runtime
  app.dropUserConnections = dropUserConnections;
});

afterEach(() => {
  upsertCalls.length = 0;
  dropUserConnections.mockClear();
  constructEventAsync.mockClear();
  constructEventAsync.mockImplementation(async (body: Buffer, signature: string) => {
    if (signature !== "valid_signature") throw new Error("Invalid signature");
    return JSON.parse(body.toString("utf8"));
  });
});

function postWebhook(payload: object, signature: string | undefined) {
  return app.inject({
    method: "POST",
    url: "/api/billing/webhook",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    payload: JSON.stringify(payload),
  });
}

describe("POST /api/billing/webhook", () => {
  it("returns 400 when the Stripe-Signature header is missing", async () => {
    const res = await postWebhook(
      { id: "evt_1", type: "customer.subscription.updated" },
      undefined,
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when the signature is invalid", async () => {
    const res = await postWebhook(
      { id: "evt_1", type: "customer.subscription.updated" },
      "bad_signature",
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("invalid_signature");
    // Service must not be invoked on signature failure.
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns 200 + ignored=true for events not in the handler set", async () => {
    const res = await postWebhook(
      { id: "evt_unhandled", type: "payment_intent.succeeded" },
      "valid_signature",
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(true);
    expect(body.ignored).toBe(true);
    expect(upsertCalls).toHaveLength(0);
  });

  it("invokes the service and drops connections on a handled event", async () => {
    const res = await postWebhook(
      { id: "evt_2", type: "customer.subscription.updated" },
      "valid_signature",
    );
    expect(res.statusCode).toBe(200);
    expect(upsertCalls).toEqual([{ eventId: "evt_2" }]);
    expect(dropUserConnections).toHaveBeenCalledWith("user_1");
  });
});

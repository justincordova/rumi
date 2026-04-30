CREATE TABLE "subscriptions" (
  "user_id" uuid PRIMARY KEY,
  "plan" text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'max')),
  "status" text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled')),
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "trial_ends_at" timestamptz,
  "stripe_customer_id" text,
  "stripe_subscription_id" text UNIQUE,
  "current_period_end" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

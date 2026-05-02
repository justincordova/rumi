CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);

CREATE INDEX "notifications_user_unread_idx" ON "notifications" ("user_id") WHERE "read_at" IS NULL;

CREATE TABLE "notification_preferences" (
  "user_id" uuid PRIMARY KEY,
  "email_enabled" boolean NOT NULL DEFAULT TRUE,
  "invite_received_email" boolean NOT NULL DEFAULT TRUE,
  "invite_accepted_email" boolean NOT NULL DEFAULT TRUE,
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

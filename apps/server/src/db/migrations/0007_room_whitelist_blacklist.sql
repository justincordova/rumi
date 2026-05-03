-- Create room_whitelist table
CREATE TABLE IF NOT EXISTS "room_whitelist" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "room_id" UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "room_whitelist_room_email_unique" ON "room_whitelist" ("room_id", "email");

-- Create room_blacklist table
CREATE TABLE IF NOT EXISTS "room_blacklist" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "room_id" UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "room_blacklist_room_email_unique" ON "room_blacklist" ("room_id", "email");

-- Migrate pending invites (accepted_at IS NULL) to room_whitelist
INSERT INTO "room_whitelist" ("room_id", "email", "created_at")
SELECT "room_id", "invited_email", "created_at"
FROM "room_invites"
WHERE "accepted_at" IS NULL
ON CONFLICT ("room_id", "email") DO NOTHING;

-- Update notification type enum to include 'room_access_granted'
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE TEXT;
-- (The enum check is handled by Drizzle schema validation; TEXT allows all values)

-- Update existing invite_received notifications to room_access_granted
UPDATE "notifications" SET "type" = 'room_access_granted' WHERE "type" = 'invite_received';

-- Drop room_invites table (data has been migrated)
DROP TABLE IF EXISTS "room_invites";

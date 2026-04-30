-- Migrate visibility: 'link' → 'open', 'shared' → 'open', 'private' stays
UPDATE rooms SET visibility = 'open' WHERE visibility IN ('link', 'shared', 'open');
--> statement-breakpoint
-- Add guest_access column; default 'none' for all existing rows
ALTER TABLE "rooms" ADD COLUMN "guest_access" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
-- Migrate allow_guest_view → guest_access='view' where it was true
UPDATE rooms SET guest_access = 'view' WHERE allow_guest_view = true;
--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "allow_guest_view";

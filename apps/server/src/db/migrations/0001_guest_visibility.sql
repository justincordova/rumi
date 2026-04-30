-- Migrate existing data: link+canEdit → shared, link+!canEdit → open, private stays private
UPDATE rooms SET visibility = 'shared' WHERE visibility = 'link' AND link_can_edit = true;
UPDATE rooms SET visibility = 'open' WHERE visibility = 'link' AND (link_can_edit = false OR link_can_edit IS NULL);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "allow_guest_view" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "link_can_edit";

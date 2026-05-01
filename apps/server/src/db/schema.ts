import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name"),
  ownerId: uuid("owner_id").notNull(),
  visibility: text("visibility", { enum: ["open", "private"] })
    .notNull()
    .default("open"),
  guestAccess: text("guest_access", { enum: ["none", "view", "edit"] })
    .notNull()
    .default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const roomMembers = pgTable("room_members", {
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["owner", "member"] })
    .notNull()
    .default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roomInvites = pgTable("room_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  invitedEmail: text("invited_email").notNull(),
  invitedBy: uuid("invited_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export const tabs = pgTable(
  "tabs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["tab", "drawing"] }).notNull(),
    language: text("language"),
    name: text("name").notNull().default("Untitled"),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tabs_room_ordinal_unique").on(t.roomId, t.ordinal),
    check("tabs_drawing_lang_null", sql`(${t.type} <> 'drawing' OR ${t.language} IS NULL)`),
  ],
);

const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType: () => "bytea",
});

export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id").primaryKey(),
  plan: text("plan", { enum: ["free", "pro", "max"] })
    .notNull()
    .default("free"),
  status: text("status", { enum: ["active", "past_due", "canceled"] })
    .notNull()
    .default("active"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tabDocuments = pgTable("tab_documents", {
  tabId: uuid("tab_id")
    .primaryKey()
    .references(() => tabs.id, { onDelete: "cascade" }),
  state: bytea("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

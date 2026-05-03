import type {
  roomBlacklist as roomBlacklistTable,
  roomWhitelist as roomWhitelistTable,
  rooms as roomsTable,
  tabs as tabsTable,
} from "@/db/schema";
import type {
  RoomBlacklistEntry as ProtocolBlacklistEntry,
  Room as ProtocolRoom,
  RoomWhitelistEntry as ProtocolWhitelistEntry,
  TabSummary,
} from "@rumi/protocol";

export function serializeTab(t: typeof tabsTable.$inferSelect): TabSummary {
  return {
    id: t.id,
    roomId: t.roomId,
    type: t.type,
    language: t.language,
    name: t.name,
    ordinal: t.ordinal,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function serializeRoom(r: typeof roomsTable.$inferSelect): ProtocolRoom {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    ownerId: r.ownerId,
    visibility: r.visibility,
    guestAccess: r.guestAccess,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function serializeWhitelistEntry(
  w: typeof roomWhitelistTable.$inferSelect,
): ProtocolWhitelistEntry {
  return {
    id: w.id,
    roomId: w.roomId,
    email: w.email,
    createdAt: w.createdAt.toISOString(),
  };
}

export function serializeBlacklistEntry(
  b: typeof roomBlacklistTable.$inferSelect,
): ProtocolBlacklistEntry {
  return {
    id: b.id,
    roomId: b.roomId,
    email: b.email,
    createdAt: b.createdAt.toISOString(),
  };
}

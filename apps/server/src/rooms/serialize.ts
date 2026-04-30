import type {
  roomInvites as roomInvitesTable,
  rooms as roomsTable,
  tabs as tabsTable,
} from "@/db/schema";
import type {
  RoomInvite as ProtocolInvite,
  Room as ProtocolRoom,
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

export function serializeInvite(i: typeof roomInvitesTable.$inferSelect): ProtocolInvite {
  return {
    id: i.id,
    roomId: i.roomId,
    invitedEmail: i.invitedEmail,
    invitedBy: i.invitedBy,
    createdAt: i.createdAt.toISOString(),
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
  };
}

import { z } from "zod";

export const Visibility = z.enum(["open", "private"]);
export type Visibility = z.infer<typeof Visibility>;
export const GuestAccess = z.enum(["none", "view", "edit"]);
export type GuestAccess = z.infer<typeof GuestAccess>;
export const Role = z.enum(["owner", "member"]);

export const Room = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string().nullable(),
  ownerId: z.string().uuid(),
  visibility: Visibility,
  guestAccess: GuestAccess,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Room = z.infer<typeof Room>;

export const RoomInvite = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  invitedEmail: z.string().email(),
  invitedBy: z.string().uuid(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
});
export type RoomInvite = z.infer<typeof RoomInvite>;

// Tabs — declared here so GetRoomResponse can return the room's tab list.
export const TabType = z.enum(["tab", "drawing"]);
export type TabType = z.infer<typeof TabType>;

export const TabSummary = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  type: TabType,
  language: z.string().nullable(),
  name: z.string(),
  ordinal: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TabSummary = z.infer<typeof TabSummary>;

// Request bodies
export const CreateRoomBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  visibility: Visibility.optional(),
  guestAccess: GuestAccess.optional(),
});
export const UpdateRoomBody = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  visibility: Visibility.optional(),
  guestAccess: GuestAccess.optional(),
});
export const CreateInviteBody = z.object({
  email: z.string().email().toLowerCase().max(254),
});

// Tab CRUD shapes
export const CreateTabBody = z.object({
  type: TabType,
  language: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
});
export const UpdateTabBody = z.object({
  name: z.string().trim().max(100).optional(),
  language: z.string().nullable().optional(),
});
export const TabIdParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  tabId: z.string().uuid(),
});
export const CreateTabResponse = z.object({ tab: TabSummary });
export type CreateTabResponse = z.infer<typeof CreateTabResponse>;
export const UpdateTabResponse = z.object({ tab: TabSummary });
export type UpdateTabResponse = z.infer<typeof UpdateTabResponse>;

// Response bodies
export const CreateRoomResponse = z.object({ room: Room });
export type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;
export const ListRoomsResponse = z.object({
  rooms: z.array(Room.extend({ pendingInvite: z.boolean() })),
});
export type ListRoomsResponse = z.infer<typeof ListRoomsResponse>;
export const GetRoomResponse = z.object({
  room: Room,
  role: Role.nullable(),
  tabs: z.array(TabSummary),
});
export type GetRoomResponse = z.infer<typeof GetRoomResponse>;
export const UpdateRoomResponse = z.object({ room: Room });
export type UpdateRoomResponse = z.infer<typeof UpdateRoomResponse>;
export const CreateInviteResponse = z.object({ invite: RoomInvite });
export type CreateInviteResponse = z.infer<typeof CreateInviteResponse>;
export const ListInvitesResponse = z.object({ invites: z.array(RoomInvite) });
export type ListInvitesResponse = z.infer<typeof ListInvitesResponse>;

// Path params
export const SlugParam = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
});
export const InviteIdParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  id: z.string().uuid(),
});

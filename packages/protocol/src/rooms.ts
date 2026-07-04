import { z } from "zod";

export const Visibility = z.enum(["open", "private"]);
export type Visibility = z.infer<typeof Visibility>;
export const GuestAccess = z.enum(["none", "view", "edit"]);
export type GuestAccess = z.infer<typeof GuestAccess>;
export const Role = z.enum(["owner", "admin", "member"]);
export type Role = z.infer<typeof Role>;

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

export const TrashedRoom = Room.extend({
  deletedAt: z.string().nullable(),
});
export type TrashedRoom = z.infer<typeof TrashedRoom>;
export const ListTrashedRoomsResponse = z.object({
  rooms: z.array(TrashedRoom),
});
export type ListTrashedRoomsResponse = z.infer<typeof ListTrashedRoomsResponse>;

// Whitelist / Blacklist types
export const RoomWhitelistEntry = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.string(),
});
export type RoomWhitelistEntry = z.infer<typeof RoomWhitelistEntry>;

export const RoomBlacklistEntry = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.string(),
});
export type RoomBlacklistEntry = z.infer<typeof RoomBlacklistEntry>;

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
  // min(1) after trim: `null` is the way to clear a name; an empty string
  // would persist a blank-but-non-null name that create forbids and the UI's
  // null-fallback rendering can't catch.
  name: z.string().trim().min(1).max(100).nullable().optional(),
  visibility: Visibility.optional(),
  guestAccess: GuestAccess.optional(),
});
export const AddToWhitelistBody = z.object({
  email: z.string().email().toLowerCase().max(254),
});
export const AddToBlacklistBody = z.object({
  email: z.string().email().toLowerCase().max(254),
});

// Tab CRUD shapes
export const CreateTabBody = z.object({
  type: TabType,
  language: z.string().max(50).nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
});
export const UpdateTabBody = z.object({
  name: z.string().trim().max(100).optional(),
  language: z.string().max(50).nullable().optional(),
});
export const ReorderTabsBody = z.object({
  tabIds: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: "tabIds must be unique",
    }),
});
export type ReorderTabsBody = z.infer<typeof ReorderTabsBody>;
export const ReorderTabsResponse = z.object({
  tabs: z.array(TabSummary),
});
export type ReorderTabsResponse = z.infer<typeof ReorderTabsResponse>;
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
  rooms: z.array(
    Room.extend({ pendingAccess: z.boolean(), pendingWhitelistId: z.string().uuid().optional() }),
  ),
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
export const AddToWhitelistResponse = z.object({ entry: RoomWhitelistEntry });
export type AddToWhitelistResponse = z.infer<typeof AddToWhitelistResponse>;
export const ListWhitelistResponse = z.object({ entries: z.array(RoomWhitelistEntry) });
export type ListWhitelistResponse = z.infer<typeof ListWhitelistResponse>;
export const ListBlacklistResponse = z.object({ entries: z.array(RoomBlacklistEntry) });
export type ListBlacklistResponse = z.infer<typeof ListBlacklistResponse>;

// Path params
export const SlugParam = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
});
export const WhitelistIdParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  id: z.string().uuid(),
});
export const BlacklistIdParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  id: z.string().uuid(),
});

// Members
export const RoomMember = z.object({
  userId: z.string().uuid(),
  role: Role,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  joinedAt: z.string(),
});
export type RoomMember = z.infer<typeof RoomMember>;
export const ListMembersResponse = z.object({ members: z.array(RoomMember) });
export type ListMembersResponse = z.infer<typeof ListMembersResponse>;
export const UpdateMemberRoleBody = z.object({
  role: z.enum(["admin", "member"]),
});
export type UpdateMemberRoleBody = z.infer<typeof UpdateMemberRoleBody>;
export const TransferOwnershipBody = z.object({
  newOwnerId: z.string().uuid(),
});
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBody>;
export const MemberIdParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  userId: z.string().uuid(),
});

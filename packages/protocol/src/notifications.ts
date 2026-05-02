import { z } from "zod";

export const NotificationType = z.enum(["invite_received", "invite_accepted"]);
export type NotificationType = z.infer<typeof NotificationType>;

export const InviteReceivedPayload = z.object({
  inviteId: z.string().uuid(),
  roomId: z.string().uuid(),
  roomSlug: z.string(),
  roomName: z.string().nullable(),
  invitedBy: z.object({
    userId: z.string().uuid(),
    displayName: z.string().nullable(),
  }),
});
export type InviteReceivedPayload = z.infer<typeof InviteReceivedPayload>;

export const InviteAcceptedPayload = z.object({
  inviteId: z.string().uuid(),
  roomId: z.string().uuid(),
  roomSlug: z.string(),
  roomName: z.string().nullable(),
  accepterName: z.string().nullable(),
});
export type InviteAcceptedPayload = z.infer<typeof InviteAcceptedPayload>;

export const Notification = z.object({
  id: z.string().uuid(),
  type: NotificationType,
  payload: z.union([InviteReceivedPayload, InviteAcceptedPayload]),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof Notification>;

export const ListNotificationsResponse = z.object({
  notifications: z.array(Notification),
  unreadCount: z.number().int().nonnegative(),
});
export type ListNotificationsResponse = z.infer<typeof ListNotificationsResponse>;

export const MarkReadBody = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({ all: z.literal(true) }),
]);
export type MarkReadBody = z.infer<typeof MarkReadBody>;

export const NotificationPreferences = z.object({
  emailEnabled: z.boolean(),
  inviteReceivedEmail: z.boolean(),
  inviteAcceptedEmail: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const UpdateNotificationPreferencesBody = NotificationPreferences.partial();
export type UpdateNotificationPreferencesBody = z.infer<typeof UpdateNotificationPreferencesBody>;

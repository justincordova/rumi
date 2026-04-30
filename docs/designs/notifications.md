# Notifications & Email Invites

## Context

Two related gaps:

1. **No way to discover invites.** Currently invites are sent as a copied link only. If someone is invited to a private room, they have to know the slug or be told out-of-band. The bell icon in the topbar is a stub; there's no in-app feed.
2. **No email delivery.** Same problem from a different angle — invitees who don't already use Rumi never learn they were invited.

Both share the same trigger points (invite created, invite accepted), so they're designed together. In-app notifications and email are two delivery channels for the same set of events.

## Goals

- In-app notification feed accessed via the bell icon in the topbar (visible on dashboard and inside rooms)
- Two event types covered: invite received, invite accepted
- Email delivery for the same two events (with per-user opt-in/out per channel)
- Click-through from in-app notification accepts the invite and navigates to the room
- Email click-through opens Rumi (signed in or via OAuth) and lands on the same accept flow
- Per-user notification preferences in the Settings → General → Notifications section (currently a stub)

## Non-Goals

- "Member joined" notifications — open-room joins are too low-signal to be worth notifying about; high-volume rooms would generate inbox spam, and the dashboard already shows membership lists
- Real-time edit notifications (the live editor is the notification; no "Justin edited the doc" toasts)
- Browser push / desktop notifications (deferred; the settings toggle exists as a stub but no backend)
- SMS or other delivery channels
- Notification batching / digest emails (single events only at MVP)
- Per-room notification mute / subscribe controls (the per-event toggle in settings is the only mute mechanism)
- Mark-all-as-read undo, archive, or notification search
- Email templates beyond plain transactional copy

## Design

### Schema

New `notifications` table:

```ts
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  type: text("type", {
    enum: ["invite_received", "invite_accepted"],
  }).notNull(),
  payload: jsonb("payload").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Index: `(userId, createdAt DESC)` for the feed query, partial index `(userId) WHERE read_at IS NULL` for the unread badge count.

`payload` shape per type:
- `invite_received`: `{ inviteId, roomId, roomSlug, roomName, invitedBy: { userId, displayName } }`
- `invite_accepted`: `{ inviteId, roomId, roomSlug, roomName, accepterName }`

We denormalize room name / slug at write time. If a room is later renamed, old notifications keep the old name — that's fine and avoids cascading updates.

The `type` enum is intentionally extensible — adding a third or fourth type later is a Drizzle migration, not a redesign.

New `notification_preferences` table (one row per user):

```ts
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  inviteReceivedEmail: boolean("invite_received_email").notNull().default(true),
  inviteAcceptedEmail: boolean("invite_accepted_email").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Defaults are "yes for both invite events." `emailEnabled` is a master switch. No row = use defaults (same pattern as `subscriptions`).

### Backend module

```
apps/server/src/notifications/
  service.ts    — recordNotification(userId, type, payload), listNotifications(userId, opts), markRead(userId, ids)
  routes.ts     — GET /api/notifications, POST /api/notifications/read, GET/PATCH /api/notifications/preferences
  email.ts      — sendInviteEmail, sendInviteAcceptedEmail
  templates.ts  — Plain-text + minimal HTML templates per event
  unsubscribe.ts — Signed-token verify + preference toggle
```

### Trigger points

The two events fire from existing code paths:

1. **Invite received** — fires from `service.ts:createInvite`. After the invite row is created:
   - Look up the invitee's userId by `invitedEmail` (cross-reference Supabase `auth.users.email`). If found, record an in-app notification.
   - Always send the email (regardless of whether the user has a Rumi account yet — the email links to a public accept URL).

2. **Invite accepted** — fires from the path where an invite is consumed (currently `service.ts:getRoomBySlug` when a private-room user with a matching invite hits the page). Record notification + send email to the room owner.

All trigger points are server-side. No client involvement needed.

### Notification feed (in-app)

**Bell popover** in `apps/web/src/components/topbar.tsx`:

- Bell icon shows a small dot when unread > 0 (no count number — just presence)
- Click opens a `Popover` with the last 20 notifications
- Each item shows: icon (per type), one-line summary, relative time ("2h ago")
- Click on an `invite_received` item: navigates to `/r/:slug` and lets the existing `getRoomBySlug` flow accept it via the email-match path; marks the notification as read
- Click on an `invite_accepted` item: navigates to `/r/:slug`, marks read
- Footer link: "Mark all as read"
- "View all" page is deferred — the popover is the entire UI in MVP

**Real-time updates**: 30s polling. The hook fires `GET /api/notifications` every 30s while the page is visible (skips polling when `document.hidden`). WebSocket-pushed notifications were considered and rejected for MVP — they require a per-user channel doc, which is new infrastructure for a small UX gain.

### Email delivery

**Provider**: Resend.

- Clean React-email integration, $0 free tier (3k/mo), simple DX
- SES is cheaper at scale but requires more setup; revisit when volume justifies it

**Email content**: plain transactional, minimal HTML. Two templates:

1. **Invite received** —
   - Subject: "Justin invited you to a room on Rumi"
   - Body: brief copy + button "Open room" linking to `${WEB_URL}/r/${slug}` (the existing route handles invite acceptance for users with matching emails)
   - Footer: "If you weren't expecting this, you can ignore it." + "Manage email preferences" link + one-click unsubscribe link

2. **Invite accepted** —
   - Subject: "Alex joined your room {room name}"
   - Body: "Alex accepted your invite. Open the room to start collaborating."
   - Button: "Open room"
   - Footer: "Manage email preferences" link + one-click unsubscribe link

**Headers (RFC 8058 compliance):**

```
List-Unsubscribe: <https://rumi.app/api/notifications/unsubscribe?token=...>, <mailto:unsubscribe+...@mail.rumi.app>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The `List-Unsubscribe-Post` header is what makes the unsubscribe link one-click in Gmail / Apple Mail. The endpoint accepts `POST` with a body of `List-Unsubscribe=One-Click` per the RFC. Without these headers, Gmail flags us as a non-compliant bulk sender.

**Sending**: `email.ts` calls Resend's SDK; on failure, logs and swallows (we don't want a flaky email service to break invite creation). Idempotency isn't a hard concern — re-sending the same invite email is acceptable.

**From address**: `Rumi <noreply@mail.rumi.app>` or similar; requires a verified Resend domain. Document the DNS records (SPF, DKIM, DMARC) in the deployment runbook.

**Dev mode**: when `RESEND_API_KEY` is missing, log the email payload to stdout instead of sending. Same pattern as Stripe stubbing in `billing.md`.

### API endpoints

**`GET /api/notifications`** (auth)
- Query params: `?cursor=<id>&limit=20` (paginate by `createdAt`)
- Returns: `{ notifications: Notification[], unreadCount: number }`
- Used by the bell popover

**`POST /api/notifications/read`** (auth)
- Body: `{ ids: string[] }` or `{ all: true }`
- Updates `read_at = now()` for the user's notifications

**`GET /api/notifications/preferences`** (auth)
- Returns: `{ preferences: NotificationPreferences }` — falls back to defaults if no row

**`PATCH /api/notifications/preferences`** (auth)
- Body: partial `NotificationPreferences` (any subset of the boolean fields)
- Upserts the row

**`POST /api/notifications/unsubscribe`** (no auth, signed token)
- Implements the RFC 8058 one-click endpoint
- Accepts `?token=...` query param + `body=List-Unsubscribe=One-Click`
- Token is HMAC-signed `{ userId, channel: 'invite_received' | 'invite_accepted' | 'all' }` with a server secret
- On valid token, sets the corresponding preference to false (or `emailEnabled = false` for `channel: 'all'`)
- Returns 200 with a tiny "You've been unsubscribed" HTML page if the user follows the link manually

### Settings UI

Replace the stub "Email notifications" / "Desktop notifications" toggles in Settings → General → Notifications (`docs/designs/settings-redesign.md`) with real controls:

- Master "Email notifications" toggle (binds to `emailEnabled`)
- Two sub-toggles, indented + disabled when master is off:
  - "When someone invites me to a room" (`inviteReceivedEmail`)
  - "When someone accepts my invite" (`inviteAcceptedEmail`)
- "Desktop notifications" stays a stub for now

### Frontend

```
apps/web/src/components/notifications/
  bell-popover.tsx       — Bell icon + popover with feed
  notification-item.tsx  — Per-row rendering (icon + text + time)
  use-notifications.ts   — Hook: polls /api/notifications every 30s (skips when document.hidden), exposes unreadCount + items + markRead
```

Mounted in `topbar.tsx`. Hidden when not authenticated (no bell on the landing page).

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Channels | In-app + email, share triggers | Same events; one source of truth; consistent UX |
| Event scope | Two types (`invite_received`, `invite_accepted`) | High-signal events only; member-joined would generate noise on open rooms |
| Email provider | Resend | Best DX for low-volume transactional; React-email integration; cheap until we scale |
| Real-time delivery | 30s polling, not WebSocket push | Simpler, fast enough for MVP; revisit when bell-presence is stale-feeling. Skip polling when `document.hidden` to avoid background battery drain |
| Persistence | Dedicated `notifications` table with denormalized payload | Standard SaaS feed pattern; payload denorm avoids JOIN-per-row at read time |
| Preference defaults | Both invite emails on | High-signal events; users would expect to be told |
| One-click unsubscribe | RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post` headers | Gmail / Apple Mail compliance from day one; cheap to implement |
| Mark-as-read | On click, plus "Mark all" button | Simple, expected behavior |
| Notification page | Popover only at MVP, no `/notifications` route | Most users don't need a full archive; revisit if requested |
| Invite expiry | None at MVP | Invites are deep links to rooms; no expiry needed until abuse appears |

## Rejected Alternatives

- **`member_joined` event** — too low-signal; open rooms would generate inbox spam. The dashboard already shows membership; users don't need a per-join notification
- **Server-Sent Events / WebSocket-pushed notifications** — adds infrastructure; 30s poll is fine
- **Postal / Mailgun / SES at MVP** — Resend is simpler; switch later if cost demands
- **Per-room subscribe / mute** — design surface explosion; the per-event toggle in settings is the only mute mechanism MVP needs
- **Digest emails** — premature; we don't have enough volume to need batching
- **In-app toast on new notification** — too intrusive; bell badge is enough signal
- **A separate notifications inbox page** — popover handles MVP volume
- **Time-limited invite tokens** — invites stored in DB without expiry; no token to expire. The email link is just a deep link to the room

## Edge Cases & Constraints

- **Invitee doesn't have a Rumi account yet** — the email link goes to `/r/:slug`. Hitting that page redirects unauthenticated users to `/sign-in?next=/r/:slug`. After OAuth, the existing `getRoomBySlug` flow auto-accepts the invite if the user's email matches an unaccepted invite for that room. No new code needed for this path beyond ensuring the `next=` param survives the OAuth round-trip (already does).
- **User signs in with a different email than the invite** — invite is by exact-match email, so it stays unaccepted. They can be re-invited at the new email. Acceptable.
- **Owner invites themselves** — current invite flow doesn't prevent this; we don't need to add it. The notification would just be noise; consider deduping in the trigger if the invitee == inviter, but it's not a blocker.
- **Room is deleted before notification is read** — popover shows the notification; clicking 404s the room. We could soft-filter notifications for soft-deleted rooms, but at MVP scale showing a 404 toast is fine.
- **Email bounces / hard fails** — log via Resend webhooks (later); for MVP, we just trust the send.
- **Notification feed pagination** — popover loads 20; if unread count > 20, badge dot shows but the popover only renders the most recent 20. "Load more" button can ship later.
- **GDPR / data retention** — keep notifications for 90 days, then prune via a periodic job. Not built in MVP; track in the migration TODO.
- **Polling while logged out** — bell is hidden when no session; the hook doesn't run. No issue.
- **Two browser tabs, two pollers** — each tab polls every 30s independently. At MVP scale this is fine; if it becomes a load problem, switch to a `BroadcastChannel`-coordinated single poll.

## Open Questions

None — all resolved.

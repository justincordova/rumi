# Notifications & Email Invites Plan

> **Goal:** In-app notification feed (bell popover) + email delivery via Resend for two events — `invite_received` and `invite_accepted`. Per-user preferences in Settings → General → Notifications. RFC 8058 one-click unsubscribe.
> **Design doc:** `docs/designs/notifications.md`

## Current state (verified against codebase)

What's already in place:
- Bell icon stub on the dashboard topbar — `apps/web/src/components/topbar.tsx:90-93` (disabled `Button`; not rendered for room or guest views)
- Notifications stub in Settings → General — `apps/web/src/routes/_authed/settings.tsx:127-141` (renders "Coming soon" placeholder)
- Invite trigger points exist:
  - `createInvite(slug, userId, email)` — `apps/server/src/rooms/service.ts:213-236` (creates DB row, no email)
  - Invite acceptance — `apps/server/src/rooms/service.ts:152-170` inside `getRoomBySlug` (transactional accept on first room visit by matching email)
- `roomInvites` table — `apps/server/src/db/schema.ts:41-50` (no expiry field)
- `InviteDialog` UI — `apps/web/src/components/rooms/invite-dialog.tsx` (already says "Tell them to sign in with this email to join the room", an explicit acknowledgment that no email is sent)
- No `notifications/` server module
- No `notifications` or `notification_preferences` tables
- No `RESEND_API_KEY` env var
- No `bell-popover.tsx`, no `use-notifications.ts` hook

Design assumptions hold; no significant codebase drift since the design was written.

## Phase 1: Schema + protocol

**Gate:** Tables migrated; protocol schemas exported and typechecked.

### Task 1: Add `notifications` and `notification_preferences` tables

- **What:** Two new Drizzle tables.
- **Why:** Persistence for the feed and per-user delivery preferences.
- **How:**
  - Edit `apps/server/src/db/schema.ts` — append:
    ```ts
    import { jsonb, index } from "drizzle-orm/pg-core";

    export const notifications = pgTable(
      "notifications",
      {
        id: uuid("id").primaryKey().defaultRandom(),
        userId: uuid("user_id").notNull(),
        type: text("type", {
          enum: ["invite_received", "invite_accepted"],
        }).notNull(),
        payload: jsonb("payload").notNull(),
        readAt: timestamp("read_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      },
      (t) => [
        index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
        // Partial index for unread count
        index("notifications_user_unread_idx")
          .on(t.userId)
          .where(sql`${t.readAt} IS NULL`),
      ],
    );

    export const notificationPreferences = pgTable("notification_preferences", {
      userId: uuid("user_id").primaryKey(),
      emailEnabled: boolean("email_enabled").notNull().default(true),
      inviteReceivedEmail: boolean("invite_received_email").notNull().default(true),
      inviteAcceptedEmail: boolean("invite_accepted_email").notNull().default(true),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    });
    ```
    The partial index uses `sql` from `drizzle-orm` (already imported at the top of `schema.ts:1`).
  - `bunx --cwd apps/server drizzle-kit generate`
  - `bun --cwd apps/server run db:migrate`
- **Verify:** Migration file present; tables exist in Supabase; `bun run typecheck` passes.

### Task 2: Add protocol schemas

- **What:** `packages/protocol/src/notifications.ts` exporting Zod schemas for the API surface.
- **Why:** Shared types between server routes and the web client.
- **How:**
  ```ts
  import { z } from "zod";

  export const NotificationType = z.enum(["invite_received", "invite_accepted"]);
  export type NotificationType = z.infer<typeof NotificationType>;

  // Discriminated payloads
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
    z.object({ ids: z.array(z.string().uuid()).min(1) }),
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
  ```
  Re-export from `packages/protocol/src/index.ts`.
- **Verify:** `bun run typecheck` from root.

## Phase 2: Backend service + routes

**Gate:** `recordNotification`, `listNotifications`, `markRead`, preferences upsert all tested. Routes registered.

### Task 3: Notifications service

- **What:** `apps/server/src/notifications/service.ts` — service factory exposing `recordNotification`, `listNotifications`, `markRead`, `getPreferences`, `updatePreferences`.
- **Why:** Clean seam for tests; routes and trigger points call this rather than the DB directly.
- **How:**
  ```ts
  import { db } from "@/db/client";
  import { notifications, notificationPreferences } from "@/db/schema";
  import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
  import type {
    InviteReceivedPayload,
    InviteAcceptedPayload,
    NotificationPreferences,
  } from "@rumi/protocol";

  type NotificationInput =
    | { type: "invite_received"; payload: InviteReceivedPayload }
    | { type: "invite_accepted"; payload: InviteAcceptedPayload };

  const DEFAULT_PREFS: NotificationPreferences = {
    emailEnabled: true,
    inviteReceivedEmail: true,
    inviteAcceptedEmail: true,
  };

  export type NotificationsService = ReturnType<typeof createNotificationsService>;

  export function createNotificationsService() {
    return {
      async recordNotification(userId: string, input: NotificationInput) {
        // Validate payload shape at write time so a future refactor can't
        // silently store a malformed JSONB row (the column has no DB-level
        // shape enforcement).
        if (input.type === "invite_received") {
          InviteReceivedPayload.parse(input.payload);
        } else {
          InviteAcceptedPayload.parse(input.payload);
        }
        const [row] = await db.insert(notifications).values({
          userId,
          type: input.type,
          payload: input.payload,
        }).returning();
        return row!;
      },

      async listNotifications(userId: string, opts: { limit?: number; cursor?: string } = {}) {
        const limit = Math.min(opts.limit ?? 20, 50);
        const items = await db.query.notifications.findMany({
          where: eq(notifications.userId, userId),
          orderBy: [desc(notifications.createdAt)],
          limit,
        });
        const [unread] = await db.select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
        return { notifications: items, unreadCount: unread?.count ?? 0 };
      },

      async markRead(userId: string, body: { ids: string[] } | { all: true }) {
        if ("all" in body) {
          await db.update(notifications)
            .set({ readAt: new Date() })
            .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
          return;
        }
        await db.update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.userId, userId),
              inArray(notifications.id, body.ids),
              isNull(notifications.readAt),
            ),
          );
      },

      async getPreferences(userId: string): Promise<NotificationPreferences> {
        const row = await db.query.notificationPreferences.findFirst({
          where: eq(notificationPreferences.userId, userId),
        });
        return row ? {
          emailEnabled: row.emailEnabled,
          inviteReceivedEmail: row.inviteReceivedEmail,
          inviteAcceptedEmail: row.inviteAcceptedEmail,
        } : DEFAULT_PREFS;
      },

      async updatePreferences(userId: string, patch: Partial<NotificationPreferences>) {
        const current = await this.getPreferences(userId);
        const next = { ...current, ...patch };
        await db.insert(notificationPreferences)
          .values({ userId, ...next, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: notificationPreferences.userId,
            set: { ...next, updatedAt: new Date() },
          });
        return next;
      },
    };
  }
  ```
- **Verify:** `apps/server/src/notifications/service.test.ts` covers:
  - `recordNotification` inserts a row with the right shape
  - `listNotifications` returns most-recent-first, includes `unreadCount`
  - `markRead({ ids })` only updates the matching ids and only if currently unread
  - `markRead({ all: true })` updates all unread for the user
  - `getPreferences` returns defaults when no row exists
  - `updatePreferences` upserts; partial patches preserve unspecified fields

### Task 4: Email service (Resend)

- **What:** `apps/server/src/notifications/email.ts` — `sendInviteEmail`, `sendInviteAcceptedEmail`. `apps/server/src/notifications/templates.ts` for the body builders. `apps/server/src/notifications/unsubscribe.ts` for HMAC-signed token verify/sign.
- **Why:** Email delivery for both event types. Unsubscribe tokens for RFC 8058 compliance.
- **How:**
  - `bun add resend` from `apps/server/`. **Pin a recent version** that supports the `headers` field on `emails.send` (Resend SDK ≥ 4.0). If the installed version doesn't expose `headers` in its types, upgrade — otherwise the `List-Unsubscribe` headers can't be set and Gmail flags us as a non-compliant bulk sender.
  - Add env vars to `apps/server/src/lib/env.ts`:
    ```ts
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("Rumi <noreply@mail.rumi.app>"),
    UNSUBSCRIBE_HMAC_SECRET: z.string().min(32).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    // WEB_URL — used in email links. Coordinate with billing-plan Task 1
    // which adds the same var. If billing hasn't shipped first, add it here:
    WEB_URL: z.string().url().default("http://localhost:5173"),
    ```
    All optional so dev runs without them. When missing, email sends become console logs. `SUPABASE_SERVICE_ROLE_KEY` is added here for the admin lookup (Task 7 needs it to map invitee email → Supabase userId, plus look up inviter display names).
  - `apps/server/src/notifications/unsubscribe.ts`:
    ```ts
    import { env } from "@/lib/env";
    import { createHmac, timingSafeEqual } from "node:crypto";

    type Channel = "invite_received" | "invite_accepted" | "all";

    export function signUnsubscribeToken(userId: string, channel: Channel): string {
      if (!env.UNSUBSCRIBE_HMAC_SECRET) {
        throw new Error("UNSUBSCRIBE_HMAC_SECRET is not configured");
      }
      const payload = `${userId}:${channel}`;
      const sig = createHmac("sha256", env.UNSUBSCRIBE_HMAC_SECRET).update(payload).digest("base64url");
      // base64url-encode the payload too so it's URL-safe
      const encoded = Buffer.from(payload).toString("base64url");
      return `${encoded}.${sig}`;
    }

    export function verifyUnsubscribeToken(token: string): { userId: string; channel: Channel } | null {
      if (!env.UNSUBSCRIBE_HMAC_SECRET) return null;
      const [encoded, sig] = token.split(".");
      if (!encoded || !sig) return null;
      let payload: string;
      try {
        payload = Buffer.from(encoded, "base64url").toString("utf8");
      } catch {
        return null;
      }
      const expected = createHmac("sha256", env.UNSUBSCRIBE_HMAC_SECRET).update(payload).digest("base64url");
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const [userId, channel] = payload.split(":");
      if (!userId || (channel !== "invite_received" && channel !== "invite_accepted" && channel !== "all")) return null;
      return { userId, channel };
    }
    ```
  - `apps/server/src/notifications/templates.ts`:
    ```ts
    import { env } from "@/lib/env";
    import { signUnsubscribeToken } from "./unsubscribe";

    export function inviteReceivedTemplate(opts: {
      toUserId: string;
      toEmail: string;
      inviterName: string;
      roomName: string;
      roomSlug: string;
    }) {
      const url = `${env.WEB_URL}/r/${opts.roomSlug}`;
      const unsubAll = `${env.WEB_URL}/api/notifications/unsubscribe?token=${signUnsubscribeToken(opts.toUserId, "all")}`;
      const unsubChan = `${env.WEB_URL}/api/notifications/unsubscribe?token=${signUnsubscribeToken(opts.toUserId, "invite_received")}`;
      const subject = `${opts.inviterName} invited you to a room on Rumi`;
      const text = `${opts.inviterName} invited you to "${opts.roomName}" on Rumi.\n\nOpen the room: ${url}\n\nIf you weren't expecting this, you can ignore this email.\n\nManage email preferences: ${env.WEB_URL}/settings?tab=general\nUnsubscribe from invite emails: ${unsubChan}`;
      const html = renderHtml({ heading: subject, body: `${opts.inviterName} invited you to "${opts.roomName}".`, ctaUrl: url, ctaLabel: "Open room", unsubChanUrl: unsubChan });
      return { subject, text, html, listUnsubscribe: unsubAll };
    }

    export function inviteAcceptedTemplate(opts: { ... }) { /* analogous */ }

    function renderHtml(opts: { heading: string; body: string; ctaUrl: string; ctaLabel: string; unsubChanUrl: string }) {
      // Inline-styled minimal HTML — no external CSS for email-client compatibility
      return `<!doctype html>...`;
    }
    ```
  - `apps/server/src/notifications/email.ts`:
    ```ts
    import { env } from "@/lib/env";
    import { logger } from "@/lib/logger";
    import { Resend } from "resend";
    import { inviteReceivedTemplate, inviteAcceptedTemplate } from "./templates";

    let _resend: Resend | null = null;
    function getResend() {
      if (!env.RESEND_API_KEY) return null;
      if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
      return _resend;
    }

    async function send(opts: {
      to: string;
      subject: string;
      text: string;
      html: string;
      listUnsubscribe: string;
    }) {
      const resend = getResend();
      if (!resend) {
        logger.info({ to: opts.to, subject: opts.subject }, "email (stub): would send");
        return;
      }
      try {
        await resend.emails.send({
          from: env.EMAIL_FROM,
          to: opts.to,
          subject: opts.subject,
          text: opts.text,
          html: opts.html,
          headers: {
            "List-Unsubscribe": `<${opts.listUnsubscribe}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      } catch (err) {
        // Swallow + log — email failures must not break invite creation.
        // The logger.error call here is the ONLY place email failures surface;
        // call sites should NOT add their own .catch(noop) wrapper or they'll
        // also need to log themselves.
        logger.error({ err, to: opts.to }, "email send failed");
      }
    }

    export async function sendInviteEmail(args) { return send(inviteReceivedTemplate(args)); }
    export async function sendInviteAcceptedEmail(args) { return send(inviteAcceptedTemplate(args)); }
    ```
- **Verify:**
  - `apps/server/src/notifications/unsubscribe.test.ts` — sign + verify roundtrip; tampered token returns null; missing secret returns null.
  - Manual: with `RESEND_API_KEY` unset, calling the trigger logs the email stub. With it set + a verified Resend domain, an email arrives.

### Task 5: Notification API routes

- **What:** `apps/server/src/notifications/routes.ts` exporting `notificationRoutes`.
- **Why:** The web client polls these.
- **Important — auth model verified against `apps/server/src/auth/plugin.ts`:**
  - The auth plugin adds a **global `onRequest` hook** for ALL `/api/*` URLs. Routes under `/api/notifications` are auto-auth-gated — there is NO per-route `authenticate` decorator. Routes just call `req.user!.id`.
  - The unsubscribe route at `POST /api/notifications/unsubscribe` MUST be exempted from the auth hook (email-link clicks have no Bearer token). Do this by extending the auth plugin's allowlist (see Task 5a below). **Coordinate with billing-plan Task 9a — both edits touch the same allowlist; ship together if possible.**
- **How:**
  - Endpoints (all auth-required by default, courtesy of the global auth hook — no extra gating needed):
    - `GET /api/notifications` → uses `service.listNotifications(userId, { limit })`
    - `POST /api/notifications/read` body `MarkReadBody` → `service.markRead`
    - `GET /api/notifications/preferences` → `service.getPreferences`
    - `PATCH /api/notifications/preferences` body `UpdateNotificationPreferencesBody` → `service.updatePreferences`
  - The unsubscribe route is in the same plugin file but the auth-plugin allowlist exempts it (Task 5a):
    - `POST /api/notifications/unsubscribe?token=...&channel=...` (or read `channel` from the token payload)
      - Reads body or query for the RFC 8058 `List-Unsubscribe=One-Click` marker
      - Calls `verifyUnsubscribeToken(token)`. If invalid → 400. If valid → upsert preference per channel:
        - `all` → `emailEnabled = false`
        - `invite_received` → `inviteReceivedEmail = false`
        - `invite_accepted` → `inviteAcceptedEmail = false`
      - Returns 200 with a tiny HTML "Unsubscribed" page if `Accept: text/html`, otherwise 200 JSON
  - Pattern:
    ```ts
    export const notificationRoutes: FastifyPluginAsync = async (app) => {
      const service = createNotificationsService();
      const typed = app.withTypeProvider<ZodTypeProvider>();

      // Unsubscribe — public (allow-listed in auth plugin). Apply a per-route rate limit.
      app.post(
        "/unsubscribe",
        { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
        async (req, reply) => {
          const token = (req.query as { token?: string }).token;
          if (!token) return reply.code(400).send({ error: "missing_token" });
          const decoded = verifyUnsubscribeToken(token);
          if (!decoded) return reply.code(400).send({ error: "invalid_token" });
          const patch: Partial<NotificationPreferences> =
            decoded.channel === "all" ? { emailEnabled: false } :
            decoded.channel === "invite_received" ? { inviteReceivedEmail: false } :
            { inviteAcceptedEmail: false };
          await service.updatePreferences(decoded.userId, patch);
          if (req.headers.accept?.includes("text/html")) {
            return reply.type("text/html").send("<!doctype html><h1>Unsubscribed</h1>");
          }
          return { ok: true };
        },
      );

      // Auth-gated routes — auto-protected by the global auth hook
      typed.get(
        "/",
        { schema: { response: { 200: ListNotificationsResponse } } },
        async (req) => service.listNotifications(req.user!.id, {}),
      );
      typed.post(
        "/read",
        { schema: { body: MarkReadBody, response: { 200: z.object({ ok: z.boolean() }) } } },
        async (req) => { await service.markRead(req.user!.id, req.body); return { ok: true }; },
      );
      typed.get(
        "/preferences",
        async (req) => ({ preferences: await service.getPreferences(req.user!.id) }),
      );
      typed.patch(
        "/preferences",
        { schema: { body: UpdateNotificationPreferencesBody } },
        async (req) => ({ preferences: await service.updatePreferences(req.user!.id, req.body) }),
      );
    };
    ```
  - Register in `server.ts`:
    ```ts
    await app.register(notificationRoutes, { prefix: "/api/notifications" });
    ```
  - **Note on response serialization:** the GET notifications route uses `schema.response: { 200: ListNotificationsResponse }`. This makes `fastify-type-provider-zod` validate the response. Drizzle's `Date` columns serialize to ISO strings via Fastify's JSON serializer; the protocol schema accepts `z.string().datetime()`. If validation fails at runtime, add an explicit `serializeNotification(row)` helper that maps DB rows → protocol shape (same pattern as `serializeRoom` in `rooms/routes.ts`).
- **Verify:**
  - `routes.test.ts` covers each endpoint, plus:
    - Unsubscribe with invalid token → 400
    - Unsubscribe with valid `all` token → preference row updated; subsequent `getPreferences` returns `emailEnabled: false`
    - Unsubscribe via Gmail one-click flow: `curl -X POST -H 'Content-Type: application/x-www-form-urlencoded' -d 'List-Unsubscribe=One-Click' 'localhost:3000/api/notifications/unsubscribe?token=...'` returns 200
    - Mark read for another user's notification id is a no-op (filtered by `userId`)
    - Unauthenticated `GET /api/notifications` returns 401 (auth plugin still enforces)

### Task 5a: Allowlist the unsubscribe route in the auth plugin

- **What:** Update `apps/server/src/auth/plugin.ts` to exempt `POST /api/notifications/unsubscribe`.
- **Why:** Email-link clicks don't carry a Bearer token. Without this, every Gmail one-click hits 401 and silently fails.
- **How:** See **billing-plan.md Task 9a** — same edit, single allowlist. Append `{ method: "POST", pattern: /^\/api\/notifications\/unsubscribe$/ }` to the allowlist there. If the billing plan hasn't shipped first, do the allowlist refactor here.
- **Verify:** `curl -X POST localhost:3000/api/notifications/unsubscribe` reaches the route handler (returns 400 for missing token), not 401.

### Task 5b: Install `@fastify/formbody` for one-click unsubscribe

- **What:** Add `@fastify/formbody` plugin so Fastify can parse `application/x-www-form-urlencoded` request bodies.
- **Why:** Fastify only parses JSON by default. RFC 8058 one-click unsubscribe sends `Content-Type: application/x-www-form-urlencoded`. Without this plugin, Fastify returns 415 and Gmail shows the unsubscribe as failed.
- **How:**
  - `bun add @fastify/formbody` from `apps/server/`
  - In `apps/server/src/server.ts`, register before route registration:
    ```ts
    import formbody from "@fastify/formbody";
    // ...
    await app.register(formbody);
    ```
- **Verify:** The curl example above (`-d 'List-Unsubscribe=One-Click'`) returns 200, not 415.

### Task 6: Decorate Fastify with the service

- **What:** Decorate `app.notifications` so other modules (notably the rooms service trigger points) can call it.
- **Why:** Rooms `service.ts` needs to call `recordNotification` + `sendInviteEmail` after `createInvite` and after invite acceptance. Decorating keeps the Drizzle import out of the rooms service.
- **How:**
  - Edit `apps/server/src/types.d.ts` to add `notifications: NotificationsService;`
  - Edit `apps/server/src/server.ts`:
    1. **Decorate `app.notifications` BEFORE `app.service`.** Verified that `server.ts:57` does `app.decorate("service", createService(db))` — change to:
       ```ts
       app.decorate("notifications", createNotificationsService());
       app.decorate("service", createService(db, { notifications: app.notifications, supabaseAdmin }));
       ```
       This requires changing `createService(db)` to `createService(db, deps)` (Task 7). Don't pass `app` itself — that creates a circular reference.
    2. Add a `supabaseAdmin` helper that uses `SUPABASE_SERVICE_ROLE_KEY` to look up users by email. Either inline a tiny module `apps/server/src/auth/supabase-admin.ts` exposing `lookupUserIdByEmail(email)` and `getUserProfile(userId)`, or do the calls inline. New module is cleaner.
- **Verify:** `bun run typecheck` passes. `app.notifications` is callable from other code paths.

## Phase 3: Trigger points — wire into existing invite flows

**Gate:** Creating an invite produces an email + (if account exists) an in-app notification. Accepting an invite emails the owner + notifies them in-app.

### Task 7: Trigger on `createInvite` + reject self-invites at the service layer

- **What:** After a successful insert in `apps/server/src/rooms/service.ts:createInvite`, fire two side effects:
  1. Try to look up the invitee in Supabase by email. If found, record an in-app notification for that user.
  2. Always send the email.
  Also: **reject self-invites at the service layer**, before any DB write. A user inviting their own email is a no-op error, not a notification trigger.
- **Why:** Two channels for the same event. Self-invite rejection lives in the service so a developer can't accidentally re-introduce the spam case by reordering trigger logic.
- **How:**
  - **Self-invite check (first):** `createInvite` doesn't currently receive the inviter's email. Either:
    - Pass it from the route: edit the route in `apps/server/src/rooms/routes.ts` to pass `req.user!.email` into `createInvite`. Recommended — single source of truth.
    - Or look it up via `supabaseAdmin.getUserProfile(userId)` inside `createInvite`.
    Then: `if (lower === inviterEmail.toLowerCase()) throw new AppError("invalid_state", "You can't invite yourself", 400);`. (Task 16 below collapses to "Already handled here.")
  - Refactor `createInvite` signature: `createService(db)` becomes `createService(db, { notifications, supabaseAdmin })` (see Task 6). Pass deps through.
  - **Looking up the invitee's userId by email** requires the Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY`, added in Task 4). When unset, skip the in-app notification (still send email). The `supabaseAdmin` helper added in Task 6 provides `lookupUserIdByEmail(email)` and `getUserProfile(userId)`.
  - Inside `createInvite`, after insert:
    ```ts
    const inviter = req.user; // not available here — need the inviter's display name
    // ...
    const inviteeUserId = await supabaseAdmin.lookupUserIdByEmail(lower).catch(() => null);

    if (inviteeUserId) {
      await notifications.recordNotification(inviteeUserId, {
        type: "invite_received",
        payload: {
          inviteId: invite.id,
          roomId: room.id,
          roomSlug: room.slug,
          roomName: room.name ?? null,
          invitedBy: { userId: opts.ownerId, displayName: inviterDisplayName ?? null },
        },
      });
    }
    // Email always sent (idempotency: re-sending the same email is acceptable)
    await sendInviteEmail({
      toUserId: inviteeUserId ?? "anon",
      toEmail: lower,
      inviterName: inviterDisplayName ?? "Someone",
      roomName: room.name ?? room.slug,
      roomSlug: room.slug,
    });
    ```
    Note: `inviterDisplayName` isn't currently passed to `createInvite`. Either:
    - **Option A (preferred):** look it up from Supabase via the same admin client (one extra fetch).
    - Option B: extend the route to pass the inviter's display name from `req.user`.
    Pick A — the admin client is already in play for the invitee lookup; reusing it keeps the route signature unchanged.
  - Email sending is fire-and-forget — don't await if it'd slow the API response. **Recommendation:** await the in-app notification (it's a single fast DB insert) but fire-and-forget the email: `void sendInviteEmail(...)`. The `send()` helper in Task 4 already swallows errors and logs them, so no `.catch()` is needed at the call site — adding one would silence the log.
- **Verify:** Integration test: `POST /api/rooms/:slug/invites` with a known email → DB row in `notifications` for the invitee user, email send was attempted (mock Resend SDK).

### Task 8: Trigger on invite acceptance

- **What:** Inside the transaction in `apps/server/src/rooms/service.ts:getRoomBySlug` where `acceptedAt` is set (line 161-170), after the transaction commits AND only when the acceptance was a state transition (i.e. the invite was actually consumed this call, not by a previous call), fire:
  1. In-app notification to the room owner: `invite_accepted`
  2. Email to the room owner
- **Why:** Owners want to know when invitees join. Firing only on the transition prevents duplicate notifications on every page load by an already-joined member.
- **How:**
  - Refactor the transaction block so it returns whether the invite was actually consumed:
    - Use the UPDATE's returning rows: `tx.update(roomInvites).set({ acceptedAt: new Date() }).where(and(eq(...), isNull(...))).returning({ id: roomInvites.id })`.
    - If `result.length > 0`, the invite was consumed THIS call; capture the invite + room info so post-transaction code can fire side effects.
    - If `result.length === 0`, another concurrent call won the race; skip side effects.
  - After the transaction commits and only when the invite was consumed:
    - Look up the owner's email + display name (Supabase admin) once per accept.
  - Honor preferences:
    ```ts
    const ownerPrefs = await notifications.getPreferences(room.ownerId);
    // Always record in-app notification (preference flag is for email only).
    await notifications.recordNotification(room.ownerId, {
      type: "invite_accepted",
      payload: { ... },
    });
    if (ownerPrefs.emailEnabled && ownerPrefs.inviteAcceptedEmail) {
      void sendInviteAcceptedEmail({ ... }); // send() swallows errors internally
    }
    ```
  - Apply the same preference gate in Task 7's email path (`inviteReceivedEmail` toggle for the invitee).
- **Verify:**
  - When an invitee with `inviteReceivedEmail = false` is invited → DB notification recorded but no email send attempt.
  - When the owner has `emailEnabled = false` → no acceptance email regardless of `inviteAcceptedEmail`.

## Phase 4: Frontend — bell popover, settings UI

**Gate:** Bell popover shows the feed; clicks navigate; mark-read works; settings toggles persist.

### Task 9: `use-notifications.ts` hook

- **What:** `apps/web/src/components/notifications/use-notifications.ts` — Zustand-or-local-state hook that polls `GET /api/notifications` every 30s while `document.visibilityState === "visible"`.
- **Why:** Powers the bell popover.
- **How:**
  ```ts
  import { useEffect, useState } from "react";
  import { apiFetch } from "@/lib/api";
  import type { Notification, ListNotificationsResponse } from "@rumi/protocol";

  export function useNotifications() {
    const [items, setItems] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);

    async function refetch() {
      setLoading(true);
      try {
        const data = await apiFetch<ListNotificationsResponse>("/api/notifications");
        setItems(data.notifications);
        setUnreadCount(data.unreadCount);
      } finally {
        setLoading(false);
      }
    }

    // Use a ref for the timer to survive React 18 strict-mode double-mount.
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
      refetch();
      function start() {
        if (timerRef.current) return;
        timerRef.current = setInterval(() => {
          if (document.visibilityState === "visible") refetch();
        }, 30_000);
      }
      function stop() {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
      function onVis() {
        if (document.visibilityState === "visible") {
          refetch();
          start();
        } else {
          stop();
        }
      }
      start();
      document.addEventListener("visibilitychange", onVis);
      return () => {
        stop();
        document.removeEventListener("visibilitychange", onVis);
      };
    }, []);

    async function markRead(ids: string[]) {
      // optimistic
      const now = new Date().toISOString();
      setItems((cur) => cur.map((n) => ids.includes(n.id) ? { ...n, readAt: now } : n));
      setUnreadCount((c) => Math.max(0, c - ids.length));
      try { await apiFetch("/api/notifications/read", { method: "POST", body: { ids } }); }
      catch { refetch(); }
    }

    async function markAllRead() {
      setItems((cur) => cur.map((n) => n.readAt ? n : { ...n, readAt: new Date().toISOString() }));
      setUnreadCount(0);
      try { await apiFetch("/api/notifications/read", { method: "POST", body: { all: true } }); }
      catch { refetch(); }
    }

    return { items, unreadCount, loading, refetch, markRead, markAllRead };
  }
  ```
- **Verify:** Mounting the hook hits the API once; tab visibility off → polling pauses; on → polling resumes immediately + after 30s.

### Task 10: `bell-popover.tsx` and `notification-item.tsx`

- **What:** New components in `apps/web/src/components/notifications/`.
- **Why:** Visual surface for the feed.
- **How:**
  - `bell-popover.tsx`: replaces the disabled `<Button disabled><Bell ... /></Button>` in `apps/web/src/components/topbar.tsx:90-93`. Wires to `useNotifications`. Shows a small dot when `unreadCount > 0` (no number).
  - On Popover open, mark all currently-displayed notifications as read after a short delay (1s)? **Decision: no auto-mark.** Click on individual item OR "Mark all as read" button explicitly marks read. Avoids silent state changes.
  - Popover content:
    - Header: "Notifications" + "Mark all as read" button (only shown if `unreadCount > 0`)
    - List: up to 20 items via `notification-item.tsx`
    - Footer: empty state if zero items
  - `notification-item.tsx`: renders icon, one-line summary, relative time. Click handler:
    - For `invite_received`: `navigate({ to: "/r/$slug", params: { slug: payload.roomSlug } })` + `markRead([id])`
    - For `invite_accepted`: same destination + `markRead([id])`
  - Time formatting: small `formatRelativeTime(isoString)` helper. If a util like this exists in `lib/utils.ts`, reuse; otherwise add a tiny one (no `date-fns` dependency for one helper).
- **Verify:**
  - Bell shows dot when unread > 0
  - Clicking an `invite_received` item navigates to the room AND the next refetch shows the item as read
  - Empty state ("No notifications yet")

### Task 11: Replace bell stub in topbar

- **What:** Edit `apps/web/src/components/topbar.tsx:90-93` to render the new `<BellPopover />` instead of the disabled button. Render it for **both dashboard and room views** (anywhere there's a logged-in user). Hidden for guests (no session).
- **Why:** The design doc (line 14) says "visible on dashboard and inside rooms." The existing `topbar.tsx` only shows the bell on the `!room` branch — that's the stub state, not the intended final state.
- **How:**
  - Add `<BellPopover />` to the dashboard branch (existing) AND to the room branch:
    ```tsx
    {!room && (
      <>
        <Link to="/upgrade" /* ... unchanged */ />
        <BellPopover />
      </>
    )}
    {/* For room view: insert <BellPopover /> next to PresenceAvatars / before Share button */}
    {room && !isGuest && <BellPopover />}
    ```
  - Place it visually consistently with the dashboard placement (icon size, spacing).
  - Import `BellPopover` from `@/components/notifications/bell-popover`.
- **Verify:** Dashboard shows the bell with a working popover. Room view also shows the bell. Guest view does NOT show it. Click on a notification in a room view navigates correctly (may navigate away from the current room — acceptable; clicking an invite is a deliberate context-switch).

### Task 12: Settings → Notifications real controls

- **What:** Replace the "Coming soon" stub at `apps/web/src/routes/_authed/settings.tsx:127-141` with real controls.
- **Why:** Per-user opt-in/out.
- **How:**
  - Replace `NotificationsSection` with:
    ```tsx
    function NotificationsSection() {
      const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);

      useEffect(() => {
        apiFetch<{ preferences: NotificationPreferences }>("/api/notifications/preferences")
          .then((r) => setPrefs(r.preferences))
          .catch(() => setPrefs({ emailEnabled: true, inviteReceivedEmail: true, inviteAcceptedEmail: true }));
      }, []);

      async function update(patch: Partial<NotificationPreferences>) {
        const optimistic = { ...(prefs ?? defaults), ...patch };
        setPrefs(optimistic);
        try {
          const res = await apiFetch<{ preferences: NotificationPreferences }>("/api/notifications/preferences", { method: "PATCH", body: patch });
          setPrefs(res.preferences);
        } catch {
          toast.error("Couldn't update preferences");
        }
      }

      if (!prefs) return <SectionSkeleton />;

      return (
        <section className="border rounded-xl p-5 space-y-4">
          <Header title="Notifications" desc="Email notification preferences." />
          <Toggle label="Email notifications" checked={prefs.emailEnabled} onChange={(v) => update({ emailEnabled: v })} />
          <div className="pl-4 space-y-2">
            <Toggle
              label="When someone invites me to a room"
              checked={prefs.inviteReceivedEmail}
              disabled={!prefs.emailEnabled}
              onChange={(v) => update({ inviteReceivedEmail: v })}
            />
            <Toggle
              label="When someone accepts my invite"
              checked={prefs.inviteAcceptedEmail}
              disabled={!prefs.emailEnabled}
              onChange={(v) => update({ inviteAcceptedEmail: v })}
            />
          </div>
          <div className="pt-2 border-t">
            <Toggle label="Desktop notifications" checked={false} disabled onChange={() => {}} />
            <p className="text-[11px] text-muted-foreground mt-1">Coming soon</p>
          </div>
        </section>
      );
    }
    ```
    `Toggle` is a small inline component using existing UI primitives (or import `Switch` from `@/components/ui` if available; otherwise build a small one with a button).
- **Verify:** Saving toggles persists across reloads (PATCH then GET roundtrip).

### Task 13: Update `InviteDialog` copy

- **What:** Update `apps/web/src/components/rooms/invite-dialog.tsx:72-74` — the help text says "Tell them to sign in with this email to join the room" because emails weren't sent before. With email delivery shipping, change copy to: *"They'll receive an email with a link to the room. They need to sign in with this email to join."*
- **Why:** Reflects reality.
- **How:** Edit line 73.
- **Verify:** Manual check.

## Phase 5: Edge cases + polish

### Task 14: Handle invitee-doesn't-have-account

- **Verified by design:** when an invitee doesn't have a Rumi account, the email link points to `/r/:slug`. Hitting that page redirects unauthed users to `/sign-in?next=/r/:slug`. After OAuth, the existing `getRoomBySlug` flow auto-accepts the invite if the user's email matches an unaccepted invite for that room. **No new code needed** — just confirm `next=` survives the OAuth round trip in current code. Check `apps/web/src/routes/auth/callback.tsx` and `signInWithProvider` flow.
- **Verify:** Manual: open an incognito browser, click an invite email link, sign in with the matching email, land on the room.

### Task 15: Handle room deletion before notification read

- **Decision per design:** show the notification, click navigates and 404s. Don't pre-filter for soft-deleted rooms. Acceptable at MVP.
- **What to do here:** nothing in code; the room route's existing 404 handling is fine. Add a note in code comments referencing this design choice if relevant.

### Task 16: Self-invite handling

- **What:** Already handled at the service layer in Task 7 — `createInvite` rejects self-invites with `invalid_state` before any side effect fires.
- **Why:** Centralizing the check at the service layer means a developer can't accidentally re-introduce the spam case by reordering trigger logic.
- **Verify:** `service.test.ts` covers: `createInvite` with the inviter's own email → throws `invalid_state` → no DB row, no notification, no email.

## Phase 6: Documentation + dev story

### Task 17: Document Resend setup

- **What:** Add a section to `apps/server/README.md` (or new `apps/server/EMAIL.md`) covering:
  - Resend account creation, domain verification (SPF, DKIM, DMARC records)
  - `RESEND_API_KEY`, `EMAIL_FROM`, `UNSUBSCRIBE_HMAC_SECRET` env vars
  - Dev mode: with `RESEND_API_KEY` unset, sends are stubbed to logs
  - Generating a strong `UNSUBSCRIBE_HMAC_SECRET`: `openssl rand -base64 32`
- **Why:** First-day onboarding for the next contributor.

### Task 18: Pre-launch checklist

- [ ] Resend API key set in production
- [ ] Mail domain verified in Resend with all DNS records (SPF, DKIM, DMARC) green
- [ ] `EMAIL_FROM` set to a verified domain address
- [ ] `UNSUBSCRIBE_HMAC_SECRET` set (32+ chars) and committed only to env vault, not repo
- [ ] Test send: invite a real email → email arrives, "Open room" link works, list-unsubscribe header appears in headers
- [ ] One-click unsubscribe test: in Gmail, hit the unsubscribe link → preference flips to false → next event doesn't send
- [ ] DB indexes verified in Supabase: `notifications_user_created_idx` and the partial unread index

## Phase 7: Pre-commit gate

`bun run check` → `bun run typecheck` → `bun test apps packages` → `vite build`. All must pass.

## Out of scope (deferred per design doc)

- "Member joined" notifications (open-room joins are too low-signal)
- Real-time edit notifications
- Browser push / desktop notifications (toggle stays a stub)
- SMS or other channels
- Digest emails / batching
- Per-room mute / subscribe controls
- `/notifications` archive route (popover-only at MVP)
- Mark-all-as-read undo, archive, search
- Email templates beyond the two transactional ones
- 90-day retention purge cron (track separately as a TODO; not built in MVP)

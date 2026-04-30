# Settings Page & Pricing Tiers Plan

> **Goal:** Add a `/settings` page with Appearance/Account/Plan sections, a `subscriptions` table, plan-aware room/tab limits, concurrent user enforcement in WS auth, and a `GET /api/subscriptions/me` endpoint.
> **Design docs:** `docs/designs/settings.md`, `docs/designs/pricing-tiers.md`

## Phase 1: Backend — Schema, Plan Helper, Protocol

**Gate:** Drizzle migration generated and applied; `getUserPlan` helper tested; protocol schemas exported.

### Task 1: Add `subscriptions` table to Drizzle schema

- **What:** New `subscriptions` table in the DB schema and a Drizzle migration.
- **Why:** All enforcement and the settings page API depend on this table existing.
- **How:**
  - Edit `apps/server/src/db/schema.ts` — add `subscriptions` table:
    ```ts
    export const subscriptions = pgTable("subscriptions", {
      userId: uuid("user_id").primaryKey(),
      plan: text("plan", { enum: ["free", "pro", "max"] }).notNull().default("free"),
      status: text("status", { enum: ["active", "past_due", "canceled"] }).notNull().default("active"),
      cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
      trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
      stripeCustomerId: text("stripe_customer_id"),
      stripeSubscriptionId: text("stripe_subscription_id").unique(),
      currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    });
    ```
    Import `boolean` from `drizzle-orm/pg-core` (check if already imported; add if not).
  - Run `bunx --cwd apps/server drizzle-kit generate` to generate the migration SQL.
  - Run `bun --cwd apps/server run db:migrate` to apply it.
- **Verify:** `bun run typecheck` passes. Migration file exists in `apps/server/src/db/migrations/`.

### Task 2: Add `getUserPlan` helper and plan limits config

- **What:** New `apps/server/src/rooms/plan.ts` with `getUserPlan(userId)` and plan limit constants.
- **Why:** All enforcement points (room count, tab cap, concurrent users) call this helper.
- **How:**
  - Create `apps/server/src/rooms/plan.ts`:
    ```ts
    import { db } from "@/db/client";
    import { subscriptions } from "@/db/schema";
    import { eq } from "drizzle-orm";

    export const PLAN_LIMITS = {
      free: { maxRooms: 3, maxTabsPerRoom: 3, maxConcurrentUsers: 5 },
      pro:  { maxRooms: 25, maxTabsPerRoom: 10, maxConcurrentUsers: 15 },
      max:  { maxRooms: 100, maxTabsPerRoom: 50, maxConcurrentUsers: 50 },
    } as const;

    export const MAX_ROOMS_OPEN = 10;

    export type PlanType = keyof typeof PLAN_LIMITS;

    export interface PlanLimits {
      plan: PlanType;
      maxRooms: number;
      maxTabsPerRoom: number;
      maxConcurrentUsers: number;
    }

    export async function getUserPlan(userId: string): Promise<PlanLimits> {
      const row = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });
      if (!row) return { plan: "free", ...PLAN_LIMITS.free };

      const now = new Date();
      const inTrial = row.trialEndsAt && row.trialEndsAt > now;
      const periodValid = row.currentPeriodEnd && row.currentPeriodEnd > now;
      const isActive = row.status === "active" || row.status === "past_due";
      const canceledButValid = row.cancelAtPeriodEnd && periodValid;

      if (isActive && (inTrial || periodValid || canceledButValid)) {
        const limits = PLAN_LIMITS[row.plan as PlanType] ?? PLAN_LIMITS.free;
        return { plan: row.plan as PlanType, ...limits };
      }

      return { plan: "free", ...PLAN_LIMITS.free };
    }
    ```
    Note: `getUserPlan` imports `db` directly (same pattern as `sync/authorize.ts`, `sync/control.ts`). Tests must mock `@/db/client` via `mock.module()` before importing.
  - Create `apps/server/src/rooms/plan.test.ts` — test the helper by mocking `@/db/client`:
    - No row → returns free limits
    - Active pro row → returns pro limits
    - Canceled but period not ended → returns plan limits
    - Canceled and period ended → returns free
    - Trial in progress → returns plan limits
    - Past due → returns plan limits (grace period)
- **Verify:** `bun test apps/server/src/rooms/plan.test.ts` passes.

### Task 3: Add protocol schemas for subscriptions

- **What:** Zod schemas and types in the protocol package.
- **Why:** The server route and web client need shared types for the subscription response.
- **How:**
  - Create `packages/protocol/src/subscriptions.ts`:
    ```ts
    import { z } from "zod";

    export const PlanType = z.enum(["free", "pro", "max"]);
    export type PlanType = z.infer<typeof PlanType>;

    export const SubscriptionStatus = z.enum(["active", "past_due", "canceled"]);
    export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

    export const Subscription = z.object({
      plan: PlanType,
      status: SubscriptionStatus,
      currentPeriodEnd: z.string().datetime().optional(),
    });
    export type Subscription = z.infer<typeof Subscription>;

    export const GetSubscriptionResponse = z.object({
      subscription: Subscription.nullable(),
    });
    export type GetSubscriptionResponse = z.infer<typeof GetSubscriptionResponse>;
    ```
    Named `PlanType` (not `Plan`) to match the existing pattern (`TabType`, `GuestAccess`, `Visibility`) and avoid confusion with the generic word "plan".
  - Edit `packages/protocol/src/index.ts` — add `export * from "./subscriptions";`
  - Add tests to `packages/protocol/src/protocol.test.ts` (or `index.test.ts`) that validate parsing the new schemas.
- **Verify:** `bun test packages` passes. `bun run typecheck` passes.

## Phase 2: Backend — Enforcement & API

**Gate:** Room count, tab cap, and concurrent user limits are enforced. Subscription API endpoint returns correct data.

### Task 4: Enforce room count limit in `createRoom`

- **What:** Check user's room count against plan limit before creating a room.
- **Why:** Core enforcement — prevents free users from creating more than 3 rooms. Placed before the slug loop to fail fast.
- **How:**
  - Edit `apps/server/src/rooms/service.ts` — in `createRoom`, before the slug generation loop:
    ```ts
    import { getUserPlan } from "./plan";
    // ... inside createRoom, before the for-loop:
    const plan = await getUserPlan(opts.ownerId);
    const ownedCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rooms)
      .where(and(eq(rooms.ownerId, opts.ownerId), isNull(rooms.deletedAt)));
    const count = ownedCount[0]?.count ?? 0;
    if (count >= plan.maxRooms) {
      throw new AppError(
        "plan_limit_reached",
        `${plan.plan === "free" ? "Free plan" : `${plan.plan} plan`} limited to ${plan.maxRooms} rooms. Upgrade for more.`,
        403,
      );
    }
    ```
  - Import `sql` from `drizzle-orm` (already imported).
  - Update `apps/server/src/rooms/service.test.ts` — mock `@/rooms/plan` to control `getUserPlan` return values. Test:
    - Free user at room limit → throws `plan_limit_reached`
    - Free user under limit → creates room
    - Pro user at limit (25) → throws
- **Verify:** `bun test apps/server/src/rooms/service.test.ts` passes.

### Task 5: Make tab cap plan-aware

- **What:** Replace hardcoded `TAB_CAP = 3` with `getUserPlan(userId).maxTabsPerRoom`.
- **Why:** Pro gets 10 tabs, Max gets 50, Free stays at 3.
- **How:**
  - Edit `apps/server/src/rooms/tabs.service.ts`:
    - Remove `const TAB_CAP = 3;`
    - In `authorize()`, return `userId` alongside existing returns (it's already available as `member.userId`).
    - In `createTab`, after calling `authorize`, call `getUserPlan(userId)` and use `plan.maxTabsPerRoom` instead of `TAB_CAP`.
    - Update error message to include the actual limit.
  - Update `apps/server/src/rooms/tabs.service.test.ts` — mock `@/rooms/plan` to return different plan limits and verify enforcement.
- **Verify:** `bun test apps/server/src/rooms/tabs.service.test.ts` passes.

### Task 6: Enforce concurrent users and rooms-open limits in WS auth

- **What:** Add plan-aware concurrent user checks and rooms-open safety cap to `onAuthenticate`.
- **Why:** Prevents room overcrowding and server memory exhaustion from too many simultaneous connections.
- **How:**

  **Where to enforce:** In `apps/server/src/sync/hocuspocus.ts`, wrapping the `onAuthenticate` call. The `onAuthenticatePayload` has `instance: Hocuspocus` which exposes `documents: Map<string, Document>`. The enforcement happens after `onAuthenticate` resolves (room and user are known) but before the connection is fully established — if enforcement fails, throw to reject the connection.

  ```ts
  // In hocuspocus.ts, wrap the onAuthenticate call:
  async onAuthenticate(data) {
    const result = await onAuthenticate(data);
    // Enforce limits after auth succeeds but before connection is established
    await enforceConnectionLimits(data);
    return result;
  },
  ```

  **Create `apps/server/src/sync/connection-limits.ts`:**

  ```ts
  import { getUserPlan, MAX_ROOMS_OPEN } from "@/rooms/plan";
  import type { onAuthenticatePayload } from "@hocuspocus/server";
  import { AppError } from "@/lib/errors";

  export async function enforceConnectionLimits(data: onAuthenticatePayload) {
    // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
    const ctx = data.context as any;
    const roomId: string | undefined = ctx.roomId;
    if (!roomId) return;

    const instance = data.instance;
    const allDocs = Array.from(instance.documents.values());

    // Only enforce on control doc connections (room:<roomId>).
    // Tab doc connections are spawned after the control doc and share the
    // same room — counting them would double-count users.
    if (!data.documentName.startsWith("room:")) return;

    // --- Concurrent users per room ---
    // Count unique users across ALL documents for this room (control + tabs).
    // Uses ctx.roomId from each connection's context (set by onAuthenticate)
    // instead of deriving from document names.
    const ownerPlan = await getUserPlan(ctx.roomOwner as string);
    const uniqueUsers = new Set<string>();
    for (const doc of allDocs) {
      for (const conn of doc.getConnections()) {
        // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
        const connCtx = conn.context as any;
        if (connCtx.roomId !== roomId) continue;
        const uid = connCtx.user?.id ?? connCtx.guestId ?? conn.socketId;
        uniqueUsers.add(uid);
      }
    }
    // Note: the connecting user is NOT yet in documents (onAuthenticate fires
    // before the connection is added), so >= is correct — they become the Nth.
    if (uniqueUsers.size >= ownerPlan.maxConcurrentUsers) {
      throw new AppError(
        "plan_limit_reached",
        "Room is full. The owner needs to upgrade for more concurrent users.",
        403,
      );
    }

    // --- Rooms open simultaneously (JWT users only) ---
    const userId: string | undefined = ctx.user?.id;
    if (!userId) return; // guests skip this check

    const userRooms = new Set<string>();
    for (const doc of allDocs) {
      for (const conn of doc.getConnections()) {
        // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
        const connCtx = conn.context as any;
        if (connCtx.user?.id === userId && connCtx.roomId) {
          userRooms.add(connCtx.roomId);
        }
      }
    }
    if (userRooms.size >= MAX_ROOMS_OPEN) {
      throw new AppError(
        "room_limit",
        "Too many rooms open. Close some tabs and try again.",
        403,
      );
    }
  }
  ```

  **Key implementation details:**
  - `data.instance` is the Hocuspocus `Server` instance — verified in the type definition (`onAuthenticatePayload.instance: Hocuspocus`).
  - `instance.documents` is a `Map<string, Document>`. Use `Array.from(instance.documents.values())` to iterate.
  - Each `Document` has `getConnections()` returning `Connection[]`. Each `Connection` has `.context` (the object set by `onAuthenticate`) and `.socketId`.
  - Use `conn.context.roomId` (set by `authorize.ts` in the return from `onAuthenticate`) to determine which room a connection belongs to. This avoids deriving roomId from document names.
  - The `onAuthenticate` return in `authorize.ts` must also include `roomOwner: room.ownerId` on the context so the concurrent user check can look up the owner's plan. Update `authorize.ts` to add `roomOwner: room.ownerId` to both `authenticateJwt` and `authenticateGuest` return objects.
  - Enforcement only runs for control doc connections (`data.documentName.startsWith("room:")`) to avoid double-counting. A user opening 3 tabs creates 1 control doc connection + 3 tab connections — only the control doc triggers the check.
  - The connecting user is NOT yet in `instance.documents` when `onAuthenticate` fires (the connection is added after auth succeeds). So `>= maxConcurrentUsers` is correct — the Nth user sees N-1 existing and is allowed through.
  - The `getUserPlan` DB call only happens on control doc connections, so a user opening 3 tabs makes 1 plan lookup, not 4.

  **Update `authorize.ts`:**
  - Add `roomOwner: room.ownerId` to the return objects from both `authenticateJwt` and `authenticateGuest`.

  **Update `hocuspocus.ts`:**
  - Import `enforceConnectionLimits` from `./connection-limits`.
  - Wrap `onAuthenticate`:
    ```ts
    async onAuthenticate(data) {
      const result = await onAuthenticate(data);
      await enforceConnectionLimits(data);
      return result;
    },
    ```

  **Tests:**
  - Create `apps/server/src/sync/connection-limits.test.ts` — mock `@/rooms/plan`, mock the Hocuspocus instance with fake documents/connections, test:
    - Under concurrent limit → passes
    - At concurrent limit → throws `plan_limit_reached`
    - Under rooms-open limit → passes
    - At rooms-open limit → throws `room_limit`
    - Tab doc connection → skips enforcement (no error)
    - Guest user → skips rooms-open check
- **Verify:** `bun test apps/server/src/sync/connection-limits.test.ts` passes. `bun run typecheck` passes.

### Task 7: Add `GET /api/subscriptions/me` endpoint

- **What:** New route that returns the authenticated user's subscription status.
- **Why:** The settings page needs this to display the current plan badge.
- **How:**
  - Create `apps/server/src/subscriptions/routes.ts`:
    ```ts
    import type { FastifyPluginAsync } from "fastify";
    import type { ZodTypeProvider } from "fastify-type-provider-zod";
    import { db } from "@/db/client";
    import { subscriptions } from "@/db/schema";
    import { eq } from "drizzle-orm";

    export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
      const typed = app.withTypeProvider<ZodTypeProvider>();

      typed.get("/me", async (req) => {
        const row = await db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, req.user!.id),
        });
        if (!row) {
          return { subscription: null };
        }
        return {
          subscription: {
            plan: row.plan,
            status: row.status,
            currentPeriodEnd: row.currentPeriodEnd?.toISOString(),
          },
        };
      });
    };
    ```
    Auth is handled by `authPlugin` registered in `server.ts` before routes — `req.user` is available.
  - Register the route in `apps/server/src/server.ts`:
    ```ts
    import { subscriptionRoutes } from "./subscriptions/routes";
    // ... inside buildServer, after existing route registrations:
    await app.register(subscriptionRoutes, { prefix: "/api/subscriptions" });
    ```
  - Create `apps/server/src/subscriptions/routes.test.ts` following the pattern in `rooms/routes.test.ts` — mock `@/db/client`, test:
    - Returns `{ subscription: null }` for user with no row
    - Returns subscription data for user with a row
    - Returns 401 without auth
- **Verify:** `bun test apps/server/src/subscriptions/routes.test.ts` passes.

## Phase 3: Frontend — Settings Page & Navigation

**Gate:** Settings page renders all 3 sections. Dashboard dropdown links to `/settings`. Plan badge shows correctly.

### Task 8: Add OAuth provider to `SessionUser` and `extractProfile`

- **What:** Extend the session user type to include the OAuth provider name so the settings page can display it.
- **Why:** The Account section needs to show "GitHub" or "Google". Currently `SessionUser` doesn't expose this.
- **How:**
  - Edit `apps/web/src/lib/auth.ts`:
    - Add `provider: string | null` to the `SessionUser` interface.
    - In `extractProfile`, derive the provider from Supabase user metadata:
      ```ts
      const identities = u.app_metadata?.identities as Array<{ provider: string }> | undefined;
      const provider = identities?.[0]?.provider ?? null;
      ```
      Add `provider` to the returned object.
- **Verify:** `bun run typecheck` passes.

### Task 9: Create the settings page route

- **What:** New `apps/web/src/routes/_authed/settings.tsx` with all three sections.
- **Why:** The main deliverable — a dedicated settings page.
- **How:**
  - Create `apps/web/src/routes/_authed/settings.tsx`:
    ```tsx
    import { createFileRoute, Link } from "@tanstack/react-router";
    import { TopBar } from "@/components/topbar";
    // ... imports for usePrefs, useSession, UI_FONT/EDITOR_FONT, apiFetch, etc.

    export const Route = createFileRoute("/_authed/settings")({
      component: SettingsPage,
    });

    function SettingsPage() {
      return (
        <div className="min-h-screen flex flex-col">
          <TopBar />
          <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-10 space-y-10">
            <AppearanceSection />
            <AccountSection />
            <PlanSection />
          </main>
        </div>
      );
    }
    ```
  
  **AppearanceSection** — reads/writes `usePrefs()`:
    - Theme: three radio-like buttons (Light / Dark / System)
    - UI Font: `<select>` or segmented control using keys from `UI_FONTS`
    - Editor Font: same pattern using `EDITOR_FONTS`
    - Font size: stepper with +/- buttons, shows current size
    - Word wrap: toggle/switch
    - Compact mode: toggle/switch
    - Follow the visual style of existing settings patterns — card containers with `border rounded-xl p-6` and section headings.

  **AccountSection** — reads `useSession()`:
    - Large avatar using `Avatar` component from `@/components/ui/avatar`
    - Display name, email (read-only text)
    - OAuth provider badge: use `user.provider` (added in Task 8). Display "GitHub" or "Google" in a pill badge. If null, hide the badge.
    - Sign out button using existing `signOut()`

  **PlanSection** — fetches from API:
    - On mount, call `apiFetch<GetSubscriptionResponse>("/api/subscriptions/me")`
    - Show plan badge (colored pill: gray for Free, blue for Pro, purple for Max)
    - Usage meters:
      - Rooms: fetch room count from `useRoomsStore` (or call `GET /api/rooms` and count) — show "X / Y rooms"
      - Tabs per room: show "Up to N tabs per room" from plan limits (hardcode the limits client-side in a shared config, or derive from the subscription response)
    - "Upgrade" button — disabled with tooltip "Coming soon"
    - Graceful fallback: if API call fails, show "Free" badge

  Use existing UI components from `@/components/ui/` (button, avatar, label, tooltip).
- **Verify:** `bun run typecheck` passes. Navigate to `/settings` in the browser — all 3 sections render.

### Task 10: Wire dashboard dropdown to settings page

- **What:** Enable the "Settings" item in the dashboard user dropdown to navigate to `/settings`.
- **Why:** Users need a way to discover and navigate to settings.
- **How:**
  - Edit `apps/web/src/components/topbar.tsx` — in the dashboard user dropdown (around line 241-252):
    - Change the disabled "Settings" `DropdownMenuItem` to use `onSelect` with `useNavigate`:
      ```tsx
      const navigate = useNavigate();
      // ...
      <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
        <Settings className="h-3.5 w-3.5 mr-2" />
        Settings
      </DropdownMenuItem>
      ```
    - "Upgrade" and "Billing" items stay disabled for now.
  - Import `useNavigate` from `@tanstack/react-router` in `TopBar`.
- **Verify:** Click user avatar on dashboard → "Settings" navigates to `/settings`. `bun run typecheck` passes.

## Phase 4: Tests & Cleanup

**Gate:** All existing tests pass. New tests pass. Lint and typecheck clean.

### Task 11: Run full test suite and fix any regressions

- **What:** Ensure nothing is broken by the new code.
- **Why:** Pre-commit gate must pass.
- **How:**
  - Run `bun run check` — fix any lint/format issues.
  - Run `bun run typecheck` — fix any type errors.
  - Run `bun test apps packages` — fix any test failures.
  - Common gotchas:
    - Service tests that mock `@/db/client` need to also mock `@/rooms/plan` if `getUserPlan` is called transitively.
    - `authorize.test.ts` may need updated mocks if `onAuthenticate` return shape changes (added `roomOwner`).
    - `server.ts` imports new subscription routes — the existing test mocks in `routes.test.ts` may need to handle the new registration.
    - `hocuspocus.ts` now calls `enforceConnectionLimits` after `onAuthenticate` — any test importing `buildHocuspocus` may need to mock `@/sync/connection-limits`.
- **Verify:** All three commands exit with code 0.

### Task 12: Update TODO.md — check off completed items

- **What:** Mark items 1 and 2 in `docs/TODO.md` as complete. Add a handoff note for Opus.
- **Why:** Track what's done and what's next.
- **How:**
  - Edit `docs/TODO.md`:
    - Mark "## 1. Settings Page" with `✅` prefix.
    - Mark "## 2. Pricing Tiers — Define & Enforce" with `✅` prefix.
    - At the bottom, add a handoff section:
      ```markdown
      ## Handoff: Connection limit enforcement

      Items 1 (Settings Page) and 2 (Pricing Tiers) are implemented. The concurrent
      user limit and rooms-open limit are enforced in `onAuthenticate`. Here's what
      Opus needs to know:

      - `getUserPlan(userId)` in `apps/server/src/rooms/plan.ts` returns plan limits.
      - Concurrent user limit is enforced by counting unique users across all
        Hocuspocus documents for the room. Only runs on control doc connections
        (`room:<roomId>`) to avoid double-counting. See `apps/server/src/sync/connection-limits.ts`.
      - Rooms-open limit (10, all tiers) enforced the same way.
      - The `subscriptions` table has `stripe_*` columns ready for Stripe integration.
      - Settings page reads from `GET /api/subscriptions/me`.
      - Next items on the roadmap: Stripe billing (item 3), Landing page (item 4).
      ```
- **Verify:** TODO.md reflects current state.

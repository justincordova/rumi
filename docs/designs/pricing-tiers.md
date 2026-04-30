# Pricing Tiers — Define & Enforce

## Context

Rumi currently has a hardcoded 3-tab cap per room and no room count limit. Before billing can be wired up, the tier structure must be defined and enforcement must be in place. The `subscriptions` table serves as the source of truth for a user's plan — Stripe populates it later, but the schema and enforcement logic are built now.

## Goals

- Define 3 individual tiers: Free, Pro, Max (Team/Enterprise deferred)
- Add a `subscriptions` table to track per-user plan state
- Enforce room count limits at create time
- Make the tab cap plan-aware (replaces hardcoded `TAB_CAP = 3`)
- Enforce concurrent user limit per room in `onAuthenticate`
- Enforce a hard safety cap on rooms open simultaneously (all tiers)
- Expose the user's current plan via API for the settings page
- Use Stripe for billing (separate implementation in `billing.md`)

## Non-Goals

- Stripe integration / billing implementation (separate design doc: `billing.md`)
- Team/Enterprise tier with seat-based pricing
- Admin UI for managing plans
- Plan downgrade logic (Stripe webhooks handle this later)
- Tiered guest access — all tiers support all guest access options (`none` | `view` | `edit`), controlled per-room by the owner

## Tier Structure

| | Free | Pro | Max |
|---|---|---|---|
| Price (monthly) | $0 | $8/mo | $20/mo |
| Price (annual) | $0 | $80/yr (~$6.67/mo) | $200/yr (~$16.67/mo) |
| Rooms (owned) | 3 | 25 | 100 |
| Tabs per room | 3 | 10 | 50 |
| Concurrent users per room | 5 | 15 | 50 |
| Rooms open simultaneously | 10 | 10 | 10 |
| Support | Community | Email | Priority |

**Notes:**

- "Rooms open simultaneously" is a hard safety limit across all tiers — it protects the server, not a paywall. No legitimate user opens more than 10 rooms at once.
- 100 rooms and 50 tabs for Max are effectively unlimited for an individual but cap server memory exposure.
- Guest access is per-room owner config (`none` | `view` | `edit`), not tiered. All tiers get all options.
- Annual billing gives ~17% discount. Stripe Checkout handles the billing cycle; no schema change needed (Stripe stores the interval, our `current_period_end` works for both monthly and annual).
- Support tiering is ops/marketing, not code. "Email" and "Priority" are surfaced in the settings page and landing page only.

### Competitive pricing context

Research from comparable products (April 2026):

| Product | Free | Individual paid | Team/seat |
|---|---|---|---|
| Rumi | $0 | Pro $8, Max $20 | Deferred |
| HackMD | $0 | Prime $5 | Enterprise (custom) |
| Notion | $0 | Plus $10 | Business $20/seat |
| Figma | $0 | Pro $16 | Org $55/seat |
| Claude | $0 | Pro $20, Max $100 | Team $20-25/seat |
| ChatGPT | $0 | Plus $20, Pro $100 | Business $20/seat |

Rumi Pro at $8 is the cheapest individual paid tier among these competitors. This is intentional for early adoption.

### Future monetization levers (not in scope)

These are features competitors gate behind paid tiers that Rumi may add later:

- **Export** — PDF/SVG/PNG download. HackMD gates PDF behind paid. Figma gates SVG/PDF. Could be Pro+.
- **File upload size limits** — HackMD: 1MB free vs 20MB paid. Relevant when Rumi supports image embeds in markdown.
- **Version history** — Notion and HackMD gate this behind paid. Would require a `tab_versions` table.
- **Custom branding** — Notion gates "remove branding" behind paid. Could apply to shared room pages.
- **AI generation** — Credits-based, per the TODO.md roadmap item 5.

## Design

### `subscriptions` table

```sql
CREATE TABLE subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'max')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'canceled')),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Design rationale:**

- `user_id` as PK — one subscription per user (individual plans)
- **No row = free tier.** Free users never get a row. This means zero migration work for existing users and zero-friction onboarding.
- `stripe_customer_id` / `stripe_subscription_id` nullable — populated only when Stripe is wired. `stripe_subscription_id` is UNIQUE to prevent duplicate subscriptions.
- `status` supports the billing lifecycle: `active` (paid), `past_due` (payment failed, grace period), `canceled` (subscription ended, access continues until `current_period_end`).
- `cancel_at_period_end` — set to `true` when a user cancels. Access continues until `current_period_end`. The subscription stays `active` until the period ends, then `getUserPlan` downgrades to free. This is the standard SaaS cancellation pattern.
- `trial_ends_at` — set when a trial is started (Stripe Checkout can create trials). `getUserPlan` treats the subscription as active during the trial period. After the trial, Stripe either converts to paid or cancels.
- `current_period_end` — set by Stripe webhooks; used to determine when to downgrade a canceled subscription.
- The `plan` CHECK constraint is extensible — adding `team` later requires an ALTER + code change, no schema redesign.

### `getUserPlan(userId)` helper

File: `apps/server/src/rooms/plan.ts`

```
PLAN_LIMITS = {
  free: { maxRooms: 3, maxTabsPerRoom: 3, maxConcurrentUsers: 5 },
  pro:  { maxRooms: 25, maxTabsPerRoom: 10, maxConcurrentUsers: 15 },
  max:  { maxRooms: 100, maxTabsPerRoom: 50, maxConcurrentUsers: 50 },
}

MAX_ROOMS_OPEN = 10  // hard safety limit, all tiers
```

- Queries `subscriptions` for the user's row
- If no row exists, returns free tier limits
- If `trial_ends_at` is set and in the future, treats as active (trial)
- If `status != 'active'` and `current_period_end` is past, treats as free
- If `cancel_at_period_end = true` and `current_period_end` is past, treats as free
- Returns `{ plan, maxRooms, maxTabsPerRoom, maxConcurrentUsers }`

### Enforcement points

**Room count** (`rooms/service.ts` `createRoom`):
- After slug generation, before insert: count user's non-deleted owned rooms
- `SELECT COUNT(*) FROM rooms WHERE owner_id = $1 AND deleted_at IS NULL`
- Compare against `getUserPlan(userId).maxRooms`
- Throw `AppError("plan_limit_reached", "Free plan limited to 3 rooms. Upgrade for more.", 403)` if over

**Tab cap** (`rooms/tabs.service.ts` `createTab`):
- Replace hardcoded `const TAB_CAP = 3` with `await getUserPlan(userId)`
- Thread `userId` through the `authorize()` helper (it already has it via `member.userId`)
- Compare `existing.length >= planLimits.maxTabsPerRoom`
- Error message includes the limit and suggests upgrading

**Concurrent users per room** (`sync/authorize.ts` `onAuthenticate`):
- After resolving the room but before accepting the connection, count unique authenticated users currently connected to that room's Hocuspocus documents
- Hocuspocus exposes `server.documents` — find the room control doc (`room:<roomId>`) and all tab docs for that room, then collect unique `userId` values from their connections
- If count >= `getUserPlan(room.ownerId).maxConcurrentUsers`, reject with a stateless error: `{ type: "plan_limit", message: "Room is full. The owner needs to upgrade for more concurrent users." }`
- Guest connections count toward the limit but use their guest UUID as the identifier

**Rooms open simultaneously** (`sync/authorize.ts` `onAuthenticate`):
- Count how many distinct rooms the connecting user already has active Hocuspocus connections to
- If >= `MAX_ROOMS_OPEN` (10), reject with `{ type: "room_limit", message: "Too many rooms open. Close some tabs and try again." }`
- This is a hard cap across all tiers — server safety, not monetization

### API endpoint

`GET /api/subscriptions/me` (new):

- Auth required (`Authorization: Bearer <jwt>`)
- Queries `subscriptions` for `req.user!.id`
- Returns `{ subscription: { plan, status, currentPeriodEnd } | null }`
- `null` means free tier
- Used by the settings page to display current plan

### Protocol additions

Add to `packages/protocol/src/`:

- `Subscription` Zod schema: `{ plan: z.enum(['free','pro','max']), status: z.enum(['active','past_due','canceled']), currentPeriodEnd: z.string().datetime().optional() }`
- `GetSubscriptionResponse`: `{ subscription: Subscription.nullable() }`
- Export types: `Subscription`, `GetSubscriptionResponse`

### Drizzle migration

Add the `subscriptions` table to `apps/server/src/db/schema.ts` with all columns. Run `bun --cwd apps/server run db:migrate` to apply.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Table name | `subscriptions` | Standard SaaS convention; represents the billing relationship |
| Free tier representation | No row in DB | Zero migration for existing users; zero-friction signup |
| Plan limits storage | Server-side config map | 3 tiers with known limits; no admin UI needed |
| Room/tab enforcement | At create time | Simple, correct, no race conditions |
| Concurrent user enforcement | In `onAuthenticate` | Rejects before the WS connection is established; counts unique users across all docs for that room |
| Rooms-open cap | Hard 10, all tiers | Server safety limit; not monetized. Prevents a single user from consuming excessive memory. |
| No "unlimited" tiers | Max = 100 rooms, 50 tabs | Even "unlimited" tiers get finite caps to bound server memory. 100 rooms / 50 tabs is effectively unlimited for an individual. |
| Guest access | Not tiered | All tiers support all guest access options. Per-room config, not a paywall. |
| Billing provider | Stripe | Industry standard; best docs, ecosystem, and webhook support. LemonSqueezy is the alternative if merchant-of-record (handles global tax) is preferred. |

## Rejected Alternatives

- **`user_plans` table name** — less conventional; the table represents a subscription, not just plan metadata
- **Separate `plans` + `subscriptions` tables** — overkill for 3 static tiers; adds a JOIN for no benefit until plans are dynamically configurable
- **Config-only limits (no DB table)** — fast but can't represent subscription state (status, period end) which Stripe needs
- **Truly unlimited rooms/tabs for Max** — no finite ceiling means no memory bound; 100 rooms and 50 tabs are effectively unlimited for individuals without risking server stability
- **Tiered guest access** — adds complexity to the room settings UI and the ownership model for no clear revenue justification

## Edge Cases & Constraints

- User with a `canceled` subscription retains access until `current_period_end`. `getUserPlan` checks this.
- User with `cancel_at_period_end = true` keeps full access until the period ends — then downgraded to free. The `status` stays `active` during this window.
- Trial users (`trial_ends_at` in the future) get the plan's limits. After trial ends, Stripe either converts to paid or sets `status = 'canceled'`.
- `past_due` status: treated as active for a grace period (Stripe retries for ~7 days). The webhook will eventually set `canceled` if payment fails permanently.
- Room count check has a TOCTOU race (user creates rooms in two tabs simultaneously). Acceptable at MVP scale — the DB transaction provides some protection.
- Concurrent user count in `onAuthenticate` has a small race window (two users connecting at the same moment may both pass the check). Acceptable — the limit is approximate, not a hard guarantee. At worst, a room gets 1-2 users over the cap temporarily.
- Existing users with no `subscriptions` row are automatically Free tier — no migration needed.
- Concurrent user enforcement counts the **room owner's** plan limits, not the connecting user's. If a Free owner invites a Pro user, the room still gets Free limits (5 concurrent users).

## Open Questions

None — all resolved during brainstorm.

# Settings Page

## Context

Rumi's user preferences (theme, fonts, font size, word wrap, compact mode) are currently accessible only through a small dropdown in the room topbar. The dashboard user dropdown has disabled "Settings", "Upgrade", and "Billing" items. A proper `/settings` route is needed to centralize these preferences and surface plan/billing info before Stripe is wired up.

## Goals

- Provide a dedicated `/settings` route for managing user preferences and account info
- Move appearance controls out of the cramped topbar dropdown into a proper page
- Display account information (OAuth provider, email, avatar)
- Stub a Plan & Billing section that shows current plan and usage meters
- Wire the dashboard dropdown "Settings" item to navigate to the new page

## Non-Goals

- Server-synced preferences (still client-only Zustand + localStorage for MVP)
- Functional billing/upgrade flows (stub until Stripe integration)
- Notification preferences (notifications feature not yet built)

## Design

### Route

- File: `apps/web/src/routes/_authed/settings.tsx`
- Behind `_authed` auth guard (user must be authenticated)
- URL: `/settings`

### Layout

Full-width page with `max-w-2xl mx-auto` container, padded. Three sections stacked vertically, each in a card-like container with a heading and content area.

#### Section 1: Appearance

Reads/writes the existing `usePrefs()` Zustand store. Controls:

- Theme toggle (light / dark / system) — same as current dropdown
- UI font picker — dropdown of available UI fonts
- Editor font picker — dropdown of available editor fonts
- Font size stepper — decrement/increment buttons (10–24 range)
- Word wrap toggle — checkbox/switch
- Compact mode toggle — checkbox/switch

#### Section 2: Account

Read-only display fetched from `useSession()`:

- Avatar (large, centered or left-aligned)
- Display name
- Email
- OAuth provider ("GitHub" or "Google" — derived from Supabase user metadata)
- Sign out button (calls existing `signOut()`)

#### Section 3: Plan & Billing

Stub section that reads from `GET /api/subscriptions/me`:

- Current plan badge ("Free" / "Pro" / "Max") — defaults to "Free" if no subscription
- Usage meters:
  - Rooms: "X / 3 rooms" (or "X rooms (unlimited)")
  - Tabs per room: "Up to 3 tabs per room" (or "Up to 10" / "Unlimited")
- "Upgrade" button — disabled with tooltip "Coming soon"

### Navigation Changes

- Dashboard user dropdown: "Settings" item navigates to `/settings` (no longer disabled)
- "Upgrade" and "Billing" items remain disabled (will navigate to `/settings#billing` or similar later)
- Settings page has a back arrow / "Your rooms" link to return to `/` (dashboard)
- Room topbar: no changes — the room-scoped dropdown keeps its appearance controls for in-context tweaks

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Page layout | Single scrollable page | 3 sections is small; tab navigation adds complexity for no payoff |
| Appearance section | Reuse `usePrefs()` store | No new state; same data source as the topbar dropdown |
| Account section | Read-only | No profile editing in MVP; display only |
| Plan & Billing | Stub with API call | Reads from subscriptions endpoint; upgrade button is disabled placeholder |
| Settings nav | Dashboard dropdown only | No settings link in the room topbar (room page is for room-specific controls) |

## Rejected Alternatives

- Tab-based settings layout (Appearance / Account / Billing tabs) — overkill for 3 small sections
- Moving all topbar appearance controls exclusively to settings page — users expect in-context access in the room page; keep both
- Server-synced preferences — deferred per SPEC.md; client-only is simpler and sufficient for MVP

## Edge Cases & Constraints

- Guest users never see the settings page (behind `_authed` guard)
- If `GET /api/subscriptions/me` fails, plan section shows "Free" as fallback
- Usage meters are approximate (room count fetched at page load, not real-time)

## Open Questions

None — all resolved during brainstorm.

# Settings Page Redesign

## Context

The initial settings page (`/settings`) was a single-page layout with stacked sections (Appearance, Account, Plan & Billing). It included room-specific editor settings (font, font size, word wrap, compact mode) that belong in the room topbar, not in a global settings page. The plan/billing section was a minimal stub. This redesign restructures settings into a tabbed layout (General, Account, Billing) and adds a proper pricing/upgrade page in the Billing tab.

## Goals

- Restructure settings into a tabbed layout (General | Account | Billing) like Claude/Anthropic
- Move room-specific appearance controls out of settings (keep in room topbar only)
- Show linked OAuth accounts (GitHub, Google) and allow identity linking
- Allow profile name editing
- Add a Vercel/Linear-style pricing card layout with feature comparison table
- Fix topbar showing "Your rooms" on the settings page
- Add delete account confirmation dialog (UI only, no backend)

## Non-Goals

- Stripe integration or functional billing (still "Coming soon")
- Actual account deletion endpoint
- Actual notification preferences backend
- Actual identity linking/unlinking backend
- Avatar upload or editing
- Email change

## Design

### URL & Routing

- Route stays `/_authed/settings` — single file
- Tab state is local React state, not URL params (only 3 tabs, not deep-linkable)
- TopBar receives a `label` prop to override "Your rooms" with "Settings"

### Tab Layout

Horizontal tab bar below the TopBar. Three tabs: General, Account, Billing. Active tab has an underline indicator. Content area has `max-w-2xl mx-auto` like the current page.

### General Tab

Two sections in bordered cards:

**Appearance**
- Theme selector only: Light / Dark / System segmented control (same component as current, just isolated here)
- No font pickers, font size stepper, word wrap toggle, or compact mode toggle — those stay in the room topbar dropdown only

**Notifications**
- "Email notifications" — toggle switch, disabled, with muted "Coming soon" text
- "Desktop notifications" — toggle switch, disabled, with muted "Coming soon" text
- These are placeholder UI to show the shape of the settings page; no backend

### Account Tab

Five sections in bordered cards, stacked vertically:

**Profile**
- Display name: editable inline text field. On blur or Enter, calls a future `PATCH /api/user/profile` endpoint. For now, updates are local-only (no backend call, show toast "Coming soon").
- Email: read-only, displayed as muted text. Cannot be changed.

**Linked Accounts**
- Reads all identities from Supabase `user.app_metadata.identities` array
- Shows a list of supported providers (GitHub, Google):
  - If linked: provider icon + "GitHub" / "Google" + green "Connected" badge with checkmark
  - If not linked: provider icon + "GitHub" / "Google" (grayed out) + "Link" button (placeholder, shows toast "Coming soon")
- Supported providers are a static list: `[{id: "github", name: "GitHub"}, {id: "google", name: "Google"}]`
- Cross-reference against `identities` array to determine linked status

**Subscription**
- Shows current plan badge (Free / Pro / Max) with colored pill
- "Upgrade" button — onClick switches to Billing tab (calls `setTab("billing")`)
- "Payment" row with "Manage" text button — onClick switches to Billing tab

**Sign Out**
- Button that calls existing `signOut()` function

**Danger Zone**
- "Delete account" button with destructive red styling
- Opens a confirmation dialog:
  - Title: "Delete account"
  - Description: "This action cannot be undone. All your rooms, tabs, and data will be permanently deleted."
  - Text input: "Type DELETE to confirm"
  - Confirm button: disabled until user types exactly "DELETE", red destructive styling
  - Cancel button
  - On confirm: shows toast "Coming soon" (no backend endpoint yet)

### Billing Tab (Pricing/Upgrade)

**Pricing cards** — Three cards in a horizontal row (Vercel/Linear style):

- **Free** — $0/mo, shows "Current" badge if on free plan, no CTA button
- **Pro** — $8/mo, highlighted with accent border, "Popular" pill badge at top of card. CTA: "Upgrade" button (disabled, "Coming soon" tooltip)
- **Max** — $20/mo. CTA: "Upgrade" button (disabled, "Coming soon" tooltip)

Each card shows:
- Plan name
- Price
- 3-4 bullet points of key limits (rooms, tabs, concurrent users)
- CTA button or "Current" badge

The current plan card gets a subtle ring/border and "Current" text. Pro gets a slightly larger or accented card to draw the eye.

**Feature comparison table** — Below the cards:

| | Free | Pro | Max |
|---|---|---|---|
| Rooms | 3 | 25 | 100 |
| Tabs per room | 3 | 10 | 50 |
| Concurrent users | 5 | 15 | 50 |
| Guest access | View only | View + Edit | View + Edit |
| File uploads | — | 20MB | 50MB |
| Export (PDF/SVG) | — | ✓ | ✓ |
| Priority support | — | — | ✓ |

- Checkmarks (✓) for included features, dashes (—) for excluded
- Rows for features not yet built (file uploads, export) get a subtle "Planned" tag
- Table header row has plan names, matches the card order

### TopBar Change

- Add optional `label` prop to `TopBar` component
- Settings page passes `label="Settings"`
- TopBar renders the label instead of "Your rooms" when provided
- Route context: settings page uses `<TopBar label="Settings" />`, dashboard uses `<TopBar onCreateRoom={...} />`, room page uses `<TopBar room={room} />`

### SessionUser Changes

- Add `identities` field to `SessionUser` interface: `identities: Array<{provider: string}>`
- In `extractProfile`, read `u.app_metadata?.identities` and store the full array (not just the first one)
- Keep existing `provider` field as shorthand for `identities[0]?.provider` for backward compat, or remove it and derive from identities at call sites

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tab state | Local React state, not URL | Only 3 tabs, not worth routing complexity |
| Linked accounts display | Static provider list cross-referenced with identities | Simple, extensible — add new providers to the static list |
| Delete account | Confirmation dialog with "Type DELETE" pattern | Standard destructive action pattern; prevents accidents |
| Pricing cards | Three-column Vercel/Linear style | Clean, scannable, standard for developer tools |
| Feature comparison | Below cards as a table | Cards for quick scan, table for detailed comparison |
| Room-specific settings | Removed from settings, kept in room topbar | Settings is global; font/wrap/compact are per-editor preferences |
| Profile name editing | Inline text field, local-only for now | Shows the shape; backend comes with user profile endpoint |

## Rejected Alternatives

- **URL-based tabs** (`/settings/general`, `/settings/account`, `/settings/billing`) — overkill for 3 tabs, adds route file complexity
- **Sidebar navigation** (like GitHub settings) — too heavy for 3 items, wastes horizontal space at `max-w-2xl`
- **Embedding Stripe Customer Portal** — deferred until Stripe is wired; current UI is self-contained
- **Separate upgrade page** (`/upgrade`) — the billing tab within settings keeps everything in one place

## Edge Cases & Constraints

- User with no linked identities (shouldn't happen since OAuth is required, but handle gracefully)
- User with both GitHub and Google linked — show both as "Connected"
- Billing tab fetches subscription status on mount — if API fails, show "Free" as default
- Delete account dialog must disable confirm button until exact "DELETE" is typed
- Theme selector in General tab and room topbar both read/write the same `usePrefs` store — changes sync instantly

## Open Questions

None — all resolved during brainstorm.

# Rumi — Product Roadmap & TODO

Ordered by dependency and business impact. Each item links to the design doc
or plan that should be written before implementation starts (per the
brainstorm → plan → execute workflow).

Settings page, pricing-tier enforcement (room count, plan-aware tab cap,
concurrent users, rooms-open), landing page, Stripe billing, notifications,
whitelist/blacklist access model, admin role, member management (kick, leave,
promote/demote, transfer ownership), drawing grid/background sync, tab
drag-to-reorder, and subscription Zustand store are shipped.

---

## 1. Privacy Policy + Terms of Service pages

**Why next:** Required before the landing page ships publicly. Static content;
no engineering blocker beyond the routes.

**Scope:** Two new public routes (`/privacy`, `/terms`), footer links from
landing page and cookie consent modal, cookie policy section inside Privacy.

---

## 2. Misc deferred items

Items below have lightweight design stubs in
`docs/designs/misc-deferred.md`.

- **Cursor presence in editor**
- **Room restore + Trash + 30-day auto-purge**
- **Horizontal scaling** — Redis from the start so the design is
  horizontally-ready.
- **Mobile polish** — phone is best-effort today.
- **Export** — download tab content / drawings; gated behind Pro/Max.

---

## Future monetization levers

Not in current scope. Evaluate after billing has been live for a while.

- **File upload size limits** — Free tier gets a small upload cap (e.g. 1MB
  per image), Pro/Max get larger (e.g. 20MB). Relevant when Rumi supports
  image embeds in markdown tabs. Gate behind Pro+.
- **Version history** — Full tab version history with diff/restore. Would
  require a `tab_versions` table. Notion and HackMD gate this behind paid.
  Gate behind Pro+.
- **Custom branding** — Remove Rumi branding from shared/public room pages.
  Notion gates "remove branding" behind paid. Gate behind Max.
- **AI generation** — Credits-based AI features (generate text, generate
  drawings, code completion). Pro gets a monthly credit pool, Max gets a
  larger pool, Free gets none.

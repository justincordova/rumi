# Rumi — Product Roadmap & TODO

Ordered by dependency and business impact. Each item links to the design doc
or plan that should be written before implementation starts (per the
brainstorm → plan → execute workflow).

Settings page, pricing-tier enforcement (room count, plan-aware tab cap,
concurrent users, rooms-open), landing page, and Stripe billing are shipped.

---

## 1. Notifications + email invites

**Why next:** Users can collaborate in rooms but have no way to know when
they've been invited or when something changes. Bell-icon feed for invite
events (`invite_received`, `invite_accepted`) plus email delivery via Resend
with RFC 8058 one-click unsubscribe.

**Design doc:** `docs/designs/notifications.md`

---

## 2. Misc deferred items

Items below have lightweight design stubs in
`docs/designs/misc-deferred.md`.

- **Privacy Policy + Terms of Service pages** — required before the landing
  page ships publicly.
- **Cursor presence in editor**
- **Drag-to-reorder tabs**
- **Member management** — kick, leave, owner transfer, plus a third role
  (`admin`). Cross-cutting role-model section at the top of
  `docs/designs/misc-deferred.md`.
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

  **Ideas to explore:**
  - "Generate" button in the markdown toolbar → prompt → inserts generated
    text into the Y.Text at cursor (all collaborators see the insert in real
    time)
  - "Generate drawing" from a text prompt → inserts tldraw shapes
  - AI-assisted code completion in code tabs (lower priority; CodeMirror has
    extension hooks for this)

  **Design doc:** `docs/designs/ai-generation.md` (write when ready)

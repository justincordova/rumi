# Rumi — Product Roadmap & TODO

Ordered by dependency and business impact. Each item links to the design doc
or plan that should be written before implementation starts (per the
brainstorm → plan → execute workflow).

Settings page and pricing-tier enforcement (room count, plan-aware tab cap,
concurrent users, rooms-open) are already shipped. See
`docs/designs/settings.md`, `docs/designs/settings-redesign.md`, and
`docs/designs/pricing-tiers.md` for the historical record.

---

## 1. Stripe Integration & Billing

**Why first:** Pricing tiers are defined and enforced. The settings Billing
tab and pricing cards are stubs (disabled "Upgrade" buttons). Stripe wires
those up so users can actually subscribe and have plan changes flow back into
the existing enforcement points via `getUserPlan`.

**Design doc:** `docs/designs/billing.md`

---

## 2. Landing Page

**Why second:** Needs the pricing tier table to be finalized so it can be
displayed accurately. Sequenced after billing so the CTA actually works end
to end.

**Design doc:** `docs/designs/landing-page.md`

---

## 3. AI Generation (Future)

**Why last:** Requires billing (AI credits = paid feature), stable tab types
(something to generate into), and a separate LLM provider integration.
Placeholder for now — flesh out when tiers are live and you have revenue to
fund API costs.

**Ideas to explore:**
- "Generate" button in the markdown toolbar → prompt → inserts generated text
  into the Y.Text at cursor (all collaborators see the insert in real time)
- "Generate drawing" from a text prompt → inserts tldraw shapes
- AI-assisted code completion in code tabs (lower priority; CodeMirror has
  extension hooks for this)
- Max tier includes a monthly credit pool; Pro tier has a smaller pool or
  per-use pricing

**Design doc:** `docs/designs/ai-generation.md` (write when ready)

---

## Sequencing summary

```
Stripe billing wired
    ↓
Landing page (pricing section accurate, CTA works end-to-end)
    ↓
AI generation (future, requires billing)
```

---

## Other items (no strict ordering)

Items below have lightweight design stubs in
`docs/designs/misc-deferred.md`. Email invites are folded into
`docs/designs/notifications.md` since they share trigger points.

- **Notifications + email invites** — bell-icon feed for invite events
  (`invite_received`, `invite_accepted`) plus email delivery via Resend with
  RFC 8058 one-click unsubscribe. **Design doc:**
  `docs/designs/notifications.md`.
- **Privacy Policy + Terms of Service pages** — required before the landing
  page ships publicly. See `docs/designs/misc-deferred.md`.
- **Cursor presence in editor** — see `docs/designs/misc-deferred.md`.
- **Drag-to-reorder tabs** — see `docs/designs/misc-deferred.md`.
- **Member management** — kick, leave, owner transfer, plus a third role
  (`admin`). See `docs/designs/misc-deferred.md` (cross-cutting role-model
  section at the top of that doc).
- **Room restore + Trash + 30-day auto-purge** — see
  `docs/designs/misc-deferred.md`.
- **Horizontal scaling** — Redis from the start so the design is
  horizontally-ready. See `docs/designs/misc-deferred.md`.
- **Mobile polish** — phone is best-effort today. See
  `docs/designs/misc-deferred.md`.
- **Export** — download tab content / drawings; gated behind Pro/Max. See
  `docs/designs/misc-deferred.md`.

---

## Future monetization levers

Not in current scope. Evaluate after billing is live.

- **File upload size limits** — Free tier gets a small upload cap (e.g. 1MB
  per image), Pro/Max get larger (e.g. 20MB). Relevant when Rumi supports
  image embeds in markdown tabs. Gate behind Pro+.
- **Version history** — Full tab version history with diff/restore. Would
  require a `tab_versions` table. Notion and HackMD gate this behind paid.
  Gate behind Pro+.
- **Custom branding** — Remove Rumi branding from shared/public room pages.
  Notion gates "remove branding" behind paid. Gate behind Max.
- **AI generation** — Credits-based AI features (generate text, generate
  drawings, code completion). Per item 3 above. Pro gets a monthly credit
  pool, Max gets a larger pool, Free gets none.

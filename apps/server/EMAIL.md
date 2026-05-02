# Email — Resend Setup

Rumi sends two transactional emails via [Resend](https://resend.com):

- **Invite received** — when a room owner invites someone by email
- **Invite accepted** — when an invitee joins a private room for the first time

All sends are fire-and-forget. A failed send logs an error but never breaks the invite flow.

## Dev mode (no API key)

When `RESEND_API_KEY` is unset, every send is stubbed: the payload is logged at `info` level and no network request is made. This is the default for local dev.

```
{"level":30,"msg":"email (stub): would send","to":"alice@example.com","subject":"Bob invited you to a room on Rumi"}
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Production | API key from Resend dashboard → API Keys |
| `EMAIL_FROM` | Production | Sender address, e.g. `Rumi <noreply@mail.rumi.app>`. Must be a verified Resend domain. |
| `UNSUBSCRIBE_HMAC_SECRET` | Production | 32+ char secret for signing one-click unsubscribe tokens. Generate with `openssl rand -base64 32`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Service-role key from Supabase → Settings → API. Used to look up invitee userIds and inviter display names. Without it, in-app notifications are skipped but emails still send. |

All four are optional at dev time — the server starts and functions without them.

## Resend account setup

1. Create an account at [resend.com](https://resend.com).
2. Go to **Domains** → **Add Domain** and enter your sending domain (e.g. `mail.rumi.app`).
3. Add the DNS records Resend provides:
   - **SPF** — `TXT` record on `mail.rumi.app`
   - **DKIM** — two `TXT` records (or `CNAME` if using Resend's managed DKIM)
   - **DMARC** — `TXT` record on `_dmarc.rumi.app` (start with `p=none` while monitoring)
4. Wait for domain verification (usually < 5 minutes).
5. Go to **API Keys** → **Create API Key** → scope to **Sending access** → copy the key.
6. Set `EMAIL_FROM` to an address on the verified domain: `Rumi <noreply@mail.rumi.app>`.

## One-click unsubscribe (RFC 8058)

Every email includes:

```
List-Unsubscribe: <https://rumi.app/api/notifications/unsubscribe?token=...>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The token is HMAC-SHA256 signed with `UNSUBSCRIBE_HMAC_SECRET`. The endpoint at `POST /api/notifications/unsubscribe` is public (no JWT required) and updates the user's notification preferences directly.

Gmail and Apple Mail use the `List-Unsubscribe-Post` header to show a one-click unsubscribe button. Without it, bulk senders are flagged as non-compliant.

## Pre-launch checklist

- [ ] `RESEND_API_KEY` set in production environment
- [ ] `EMAIL_FROM` set to a verified domain address (not a generic `@resend.dev` test address)
- [ ] Domain verified in Resend: SPF ✓, DKIM ✓, DMARC ✓ (all green in the Resend dashboard)
- [ ] `UNSUBSCRIBE_HMAC_SECRET` is at least 32 characters and stored in the env vault (not committed to the repo)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (enables in-app notifications and display-name lookups)
- [ ] End-to-end test: invite a real email address → email arrives, "Open room" link works, `List-Unsubscribe` header visible in Gmail's "Show original"
- [ ] One-click unsubscribe test: in Gmail, click Unsubscribe → `POST /api/notifications/unsubscribe` returns 200 → `GET /api/notifications/preferences` shows `inviteReceivedEmail: false`
- [ ] DB indexes confirmed in Supabase: `notifications_user_created_idx` and `notifications_user_unread_idx` present under Table Editor → Indexes

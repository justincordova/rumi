# Resend Setup Guide

Rumi uses [Resend](https://resend.com) for transactional email — access-granted
notifications and invite-accepted notifications. Locally the server runs in
**graceful-stub mode** when `RESEND_API_KEY` is unset: emails are logged to
stdout instead of sent. This guide covers what to do when you want real
delivery.

## 1. Sign up and verify your domain

Sign up at [resend.com](https://resend.com), then go to **Domains** → **Add
domain**.

Use a subdomain dedicated to transactional mail — for example `mail.rumi.app`
rather than the apex `rumi.app`. This isolates marketing/personal mail from
transactional mail and keeps reputation clean.

Resend will show four DNS records to add at your DNS provider:

| Record | Why |
|---|---|
| **MX** | Where bounces are sent |
| **SPF (TXT)** | Authorizes Resend to send as your domain |
| **DKIM (TXT)** | Cryptographic signature on every message |
| **DMARC (TXT)** | Policy + reporting; recommended even if optional in the dashboard |

A reasonable starting DMARC record:

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@rumi.app; aspf=s; adkim=s
```

After adding the records, click **Verify**. SPF + DKIM usually verify within a
few minutes. DMARC takes longer to propagate.

## 2. Get a production API key

**API Keys** → **Create API Key**.

- Name: `rumi-server-prod`
- Permission: **Sending access** (read-only is not enough)
- Domain: restrict to the verified domain you just set up

Copy the key — it is shown once.

## 3. Set environment variables

In production:

```env
RESEND_API_KEY=re_...
EMAIL_FROM=Rumi <noreply@mail.rumi.app>
UNSUBSCRIBE_HMAC_SECRET=<32+ random characters>
```

The `EMAIL_FROM` address must be on the verified domain. The
`UNSUBSCRIBE_HMAC_SECRET` is required when `RESEND_API_KEY` is set — it signs
the one-click unsubscribe tokens. Generate one with:

```bash
openssl rand -base64 48
```

If `RESEND_API_KEY` is missing in production, the server logs a `WARN` at
startup but still runs (graceful stub continues). Don't gate features on email
delivery.

## 4. Test delivery from staging

Easiest path: trigger an access-granted email from a real-looking flow.

1. Sign in to staging with two different Google accounts.
2. As account A, create a private room and add account B's email to the
   whitelist.
3. Account B should receive an email at the gmail address.

In the email, verify:

| Check | What to look for |
|---|---|
| **From** | The `EMAIL_FROM` you configured |
| **Subject** | Matches the template in `apps/server/src/notifications/templates.ts` |
| **SPF** | `pass` in Gmail's "Show original" |
| **DKIM** | `pass` (and shows `mail.rumi.app`) |
| **DMARC** | `pass` |
| **List-Unsubscribe header** | Present, with both `mailto:` and `https:` URLs |
| **List-Unsubscribe-Post** | `List-Unsubscribe=One-Click` |

The List-Unsubscribe headers are required for [RFC 8058 one-click
unsubscribe](https://datatracker.ietf.org/doc/html/rfc8058). Gmail's bulk
sender requirements have penalized senders missing this since Feb 2024.

## 5. Test one-click unsubscribe

Click the unsubscribe link in the test email. Expected behavior:

- Browser navigates to `/api/notifications/unsubscribe?token=...` and shows a
  brief HTML confirmation
- The user's `notification_preferences` row is updated — the relevant channel
  goes to `false` (or `email_enabled=false` if the user used the "all"
  unsubscribe path)
- Subsequent triggers do not send for that channel

Tokens are HMAC-signed with `UNSUBSCRIBE_HMAC_SECRET` and don't require auth.

## 6. Going-live checklist

- [ ] Domain verified in Resend with SPF, DKIM, and DMARC passing
- [ ] Production API key created with sending-only permission, scoped to the verified domain
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`, and `UNSUBSCRIBE_HMAC_SECRET` set in production env
- [ ] Test email from staging passes SPF/DKIM/DMARC in Gmail
- [ ] List-Unsubscribe headers present and one-click unsubscribe works
- [ ] Resend dashboard shows successful sends; no `failed` events
- [ ] DMARC `rua=` mailbox is monitored (alerts on alignment failures)

## 7. Troubleshooting

**Emails go to spam in Gmail.** Almost always SPF, DKIM, or DMARC is failing.
Open the message → "Show original" → look for the `Authentication-Results`
header. All three should say `pass`.

**`UNSUBSCRIBE_HMAC_SECRET is required when RESEND_API_KEY is set` at
startup.** Set the env var. Tokens cannot be signed without it.

**Unsubscribe link returns 400.** Either the token is malformed or
`UNSUBSCRIBE_HMAC_SECRET` is different from the one used to sign the token.
Don't rotate this secret without invalidating outstanding emails.

**`From` address rejected.** The `EMAIL_FROM` address must be on the
verified domain. `noreply@rumi.app` won't work if you only verified
`mail.rumi.app`.

**No emails arrive at all.** Check Resend dashboard → **Logs**. Look for
`bounce` or `dropped` events. If nothing shows, the request from the server
isn't reaching Resend — check `RESEND_API_KEY` is set and not stale.

## Related

- `apps/server/src/notifications/email.ts` — Resend client + graceful stub
- `apps/server/src/notifications/templates.ts` — HTML/text templates
- `apps/server/src/notifications/unsubscribe.ts` — HMAC token sign + verify

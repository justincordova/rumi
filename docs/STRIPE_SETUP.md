# Stripe Setup Guide

## 1. Test mode

Go to [dashboard.stripe.com](https://dashboard.stripe.com). Top-right corner — toggle should say **Test mode**. Keep it there for now.

---

## 2. Create products and prices

Go to **Product catalog** → **+ Add product**.

**Product 1: Rumi Pro**
- Name: `Rumi Pro`
- Pricing model: Standard pricing
- Price: `8.00` USD, Recurring, Monthly
- Click **Add another price**
- Price: `72.00` USD, Recurring, Yearly
- Save

**Product 2: Rumi Max**
- Name: `Rumi Max`
- Price: `20.00` USD, Recurring, Monthly
- Click **Add another price**
- Price: `180.00` USD, Recurring, Yearly
- Save

After saving, click into each price and copy the `price_...` ID. You need all 4:

| Env var | Price |
|---|---|
| `STRIPE_PRICE_PRO_MONTHLY` | Rumi Pro — $8/mo |
| `STRIPE_PRICE_PRO_YEARLY` | Rumi Pro — $72/yr |
| `STRIPE_PRICE_MAX_MONTHLY` | Rumi Max — $20/mo |
| `STRIPE_PRICE_MAX_YEARLY` | Rumi Max — $180/yr |

Alternatively, create them via the Stripe CLI:

```bash
# Pro — monthly
stripe prices create \
  --unit-amount 800 \
  --currency usd \
  --recurring[interval]=month \
  --product-data[name]="Rumi Pro"

# Pro — yearly
stripe prices create \
  --unit-amount 7200 \
  --currency usd \
  --recurring[interval]=year \
  --product-data[name]="Rumi Pro"

# Max — monthly
stripe prices create \
  --unit-amount 2000 \
  --currency usd \
  --recurring[interval]=month \
  --product-data[name]="Rumi Max"

# Max — yearly
stripe prices create \
  --unit-amount 18000 \
  --currency usd \
  --recurring[interval]=year \
  --product-data[name]="Rumi Max"
```

---

## 3. Configure the Customer Portal

Go to **Settings** → **Billing** → **Customer portal**.

**Turn ON:**
- ✅ Cancel subscriptions
- ✅ Update payment methods
- ✅ Invoice history
- ✅ Switch plans (Pro ↔ Max) with proration
- ✅ Switch billing intervals (monthly ↔ yearly) with proration

**Turn OFF:**
- ❌ Downgrade to free (free is handled via cancellation — the absence of a subscription — not a Stripe price)

Save.

---

## 4. Enable Stripe Tax

Go to **Settings** → **Tax** → enable **Stripe Tax**.

Handles VAT, US sales tax, and other regional taxes automatically. The code already passes `automatic_tax: { enabled: true }` on every checkout session.

---

## 5. Get your secret key

Go to **Developers** → **API keys**.

Copy the **Secret key** — starts with `sk_test_...`

---

## 6. Fill in `apps/server/.env`

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_MAX_MONTHLY=price_...
STRIPE_PRICE_MAX_YEARLY=price_...
WEB_URL=http://localhost:5173
```

Leave `STRIPE_WEBHOOK_SECRET` blank for now — you get it in the next step.

---

## 7. Forward webhooks locally

Make sure your server is running (`bun run dev:server`), then in a separate terminal:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

It prints:

```
> Ready! Your webhook signing secret is whsec_abc123...
```

Copy that `whsec_...` and add it to `apps/server/.env`:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

Restart the server so it picks up the new env var.

---

## 8. Test it end-to-end

With the server running and `stripe listen` running in a second terminal:

1. Go to `http://localhost:5173/pricing`
2. Sign in, click **Upgrade** on Pro
3. Use test card `4242 4242 4242 4242`, any future expiry, any CVC
4. Complete checkout — you should land back on `/settings?tab=billing` with a success toast
5. Check the `stripe listen` terminal — you should see:

```
--> checkout.session.completed [200]
--> invoice.paid [200]
--> customer.subscription.updated [200]
```

**Test the portal:**
1. Go to Settings → Billing → **Manage billing**
2. Try canceling — you should stay on the paid plan until the period ends, then drop to free

**Test a failed card:**
- Use card `4000 0000 0000 9995` — payment fails, user stays on free plan

**Test webhook events manually (without going through checkout):**

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

---

## 9. If the webhook returns 400

The signing secret is wrong. Check:
- The `whsec_...` in `.env` matches exactly what `stripe listen` printed
- The server was restarted after adding it

**Note:** the `whsec_...` printed by `stripe listen` is only valid for that CLI session. If you restart the CLI, you get a new secret — update `.env` and restart the server. In production, use the signing secret from the Stripe dashboard webhook endpoint (not the CLI value).

---

## 10. Going live (when ready)

1. Flip to **Live mode** in the Stripe dashboard
2. Repeat steps 2–5 in live mode — create real products, get your `sk_live_...` key
3. Go to **Developers** → **Webhooks** → **Add endpoint**
   - URL: `https://your-domain.com/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
   - Copy the signing secret from the endpoint page (different from the CLI `whsec_`)
4. Swap all env vars in production to the live-mode values

All Stripe IDs (prices, customers, subscriptions, webhook secrets) are environment-scoped — test keys never interact with live data and vice versa.

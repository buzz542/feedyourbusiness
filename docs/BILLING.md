# Billing setup (Stripe, test mode first)

Billing code lives in `src/server/billing/`. It runs in test mode only until you unlock live mode yourself.
Nothing here needs a live key, and Claude should never ask for one.

## How it works

- **Checkout:** `POST /api/billing/checkout` (signed-in user, same-origin only) creates a Stripe Checkout
  Session: subscription, 7-day trial, card required, the renewal terms shown on the payment page, Managed
  Payments (merchant of record) on. It refuses if the user already has a live subscription, including `past_due`.
- **Webhook:** `POST /api/billing/webhook` verifies the signature on the raw body, then applies the event. It
  re-fetches the subscription from Stripe instead of trusting the payload, ignores events older than the last
  one applied, and skips events it has already processed.
- **Cancel:** `POST /api/billing/cancel` with `{ "action": "cancel" | "resume" }` schedules cancellation at the
  end of the period. The Settings page (M8) calls it after one confirmation click: two clicks in total.
- **Portal:** `POST /api/billing/portal` opens the Stripe billing portal, for updating the card.
- **Reminder:** `GET /api/cron/trial-reminders` sends the email at least 48 hours before the first charge, even
  if one run fails. On the Hobby plan `vercel.json` runs it daily (73 to 98 hours ahead); once Vercel Pro is on
  it runs hourly (50 to 52 hours). `REMINDER_CRON_PERIOD_HOURS` must match the schedule, and live billing
  refuses to start until it is hourly (`docs/PLAN.md`, D6 and section 13).

Access follows `profiles.plan`, which only the webhook can change. `trialing` and `active` unlock the product.

## Steps

1. **Authorize Stripe.** In claude.ai, open Settings, then Connectors, and authorize Stripe. Until then Claude
   cannot create Stripe objects. You can also do steps 3 to 5 in the Dashboard.
2. **Confirm Managed Payments.** In the Stripe Dashboard check that your account is eligible for Managed
   Payments (https://docs.stripe.com/payments/managed-payments). Note its fees, the countries it supports, how it
   shows tax, and whether it supports free trials. If it does not fit, the brief's fallback is Paddle.
3. **Create the product** "AskedFor" with one recurring monthly price (the brief's default is $29), in test mode,
   tax-inclusive if Managed Payments allows it, so the price shown is the price paid. Copy the price id
   (`price_...`).
4. **Customer portal:** enable it in test mode and allow payment method updates. Cancellation happens in our
   own Settings page, so the portal is only for cards.
5. **Webhook endpoint:** add `https://<your-domain>/api/billing/webhook` for exactly these events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy the signing secret (`whsec_...`). Locally use
   `stripe listen --forward-to localhost:3000/api/billing/webhook` and its printed secret.
6. **Environment variables.** Production values go in Vercel only. For `.env.local` and the Claude Code
   session use the development Supabase project and Stripe test keys (`docs/PLAN.md`, F12), never the
   production Supabase secret key. Never commit them.

   | Variable                               | Value                                                    |
   | -------------------------------------- | -------------------------------------------------------- |
   | `STRIPE_SECRET_KEY`                    | `sk_test_...`                                            |
   | `STRIPE_WEBHOOK_SECRET`                | `whsec_...`                                              |
   | `STRIPE_PRICE_ID`                      | `price_...`                                              |
   | `STRIPE_MANAGED_PAYMENTS`              | `true` (the default)                                     |
   | `NEXT_PUBLIC_SITE_URL`                 | your deployed URL, or `http://localhost:3000`            |
   | `NEXT_PUBLIC_SUPABASE_URL`             | `https://hoqbflkszzoojdswbrgy.supabase.co`               |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from the Supabase dashboard, API keys                    |
   | `SUPABASE_SECRET_KEY`                  | from the Supabase dashboard, API keys. Server only.      |
   | `RESEND_API_KEY`, `EMAIL_FROM`         | from Resend, with the sending domain verified            |
   | `CRON_SECRET`                          | a long random string (Vercel sends it as a Bearer token) |

7. **Check the wiring** with one request (`docs/PLAN.md`, section 16):
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/health`. `stripe_config`,
   `stripe_price` and `stripe_webhook` must all say `ok`; anything else names what is missing.
8. **Test end to end** with Stripe's test cards: start checkout, complete it, and watch `profiles` change
   (`plan = pro`, `subscription_status = trialing`). Cancel from the portal or the cancel route and confirm
   `cancel_at_period_end`. `stripe trigger customer.subscription.created` checks the endpoint answers: the
   webhook acknowledges it as ignored (200), because a triggered subscription carries no AskedFor user.

## Before going live (you do this yourself, in manual mode)

- [ ] Managed Payments (or Paddle) is confirmed and live on the account.
- [ ] Vercel Pro is on, `vercel.json` runs `trial-reminders` hourly and `REMINDER_CRON_PERIOD_HOURS` is 1.
- [ ] Business details, support email, Terms and Privacy URLs, and statement descriptor are set in Stripe.
- [ ] The pricing page shows the full price, tax included where it applies, and renewal and cancellation terms
      before checkout.
- [ ] Test-mode run passed: checkout, trial reminder email, two-click cancel, account deletion.
- [ ] A separate live webhook endpoint exists, with its own signing secret.
- [ ] You set `STRIPE_SECRET_KEY` to the live key **and** `BILLING_LIVE_ENABLED=true`. Without both, and with
      Managed Payments off, the app refuses to start billing in live mode.
- [ ] Take one real payment with your own card, then refund it.
- [ ] A solicitor has reviewed the terms, refund wording and consent at checkout.

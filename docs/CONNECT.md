# Connecting AskedFor

Everything the code needs is built. What is left is accounts, keys and switches, set in Vercel
(Project Settings > Environment Variables, Production). After changing env vars, redeploy: public
pages are built with them.

Check your work at `https://<your-domain>/api/health` (send `Authorization: Bearer <CRON_SECRET>`). It
names every missing or wrong setting by env name, never by value.

## 1. Core (needed for anything to work)

| Env var                                                | What it is                                             | Where to get it                        |
| ------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                                 | Your production URL, no trailing slash                 | Your domain                            |
| `NEXT_PUBLIC_SUPABASE_URL`                             | `https://hoqbflkszzoojdswbrgy.supabase.co`             | Supabase > Project Settings > API      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                 | `sb_publishable_...`                                   | Supabase > Project Settings > API Keys |
| `SUPABASE_SECRET_KEY`                                  | `sb_secret_...`, server only                           | Supabase > Project Settings > API Keys |
| `CRON_SECRET`                                          | 32+ random characters                                  | `openssl rand -hex 32`                 |
| `AUTHOR_HASH_PEPPER`                                   | 32+ random characters. Never change it once set        | `openssl rand -hex 32`                 |
| `APP_HMAC_SECRET`                                      | 32+ random characters (unsubscribe links, rate limits) | `openssl rand -hex 32`                 |
| `ANTHROPIC_API_KEY`                                    | The model key. Without it nothing is collected         | console.anthropic.com                  |
| `LLM_MONTHLY_USD_CAP_PER_PRODUCT`, `LLM_DAILY_USD_CAP` | Spend caps, default 3 and 25                           | Your choice                            |

Database: every migration in `supabase/migrations/` must be applied to the production project
(`npm run db:migrate`, or the Supabase connector's `apply_migration`). Make yourself admin with
`update public.profiles set is_admin = true where id = '<your user id>';` in the SQL editor, then
`/admin` shows the removal queue, source health and costs.

Supabase Auth (docs/PLAN.md F5): Site URL is your production URL; Redirect URLs include
`<production>/auth/callback**`. SMTP through Resend (below) so sign-in links come from your domain.

## 2. Email (Resend)

| Env var          | Value                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `RESEND_API_KEY` | `re_...` from resend.com, after verifying your domain (SPF, DKIM) |
| `EMAIL_FROM`     | `AskedFor <hello@yourdomain>` on the verified domain              |

Without it the app runs, but sends no feed-ready, daily, weekly, reminder or removal emails.

## 3. Sources

Every collect source has a kill switch, `SOURCE_<ID>_ENABLED=true`. Anything else means off.

### Hacker News (free, no key)

- `SOURCE_HACKERNEWS_ENABLED=true`

### Bluesky (free)

1. Create a dedicated Bluesky account for AskedFor (not your personal one).
2. Settings > Privacy and security > App passwords > Add. Copy it.
3. Set `BLUESKY_IDENTIFIER` (the account's handle), `BLUESKY_APP_PASSWORD`, and
   `SOURCE_BLUESKY_ENABLED=true`.

### Reddit (Bright Data, paid)

Reddit comes only through Bright Data's Web Scraper API (decision D1). Production keeps it off until
three things hold, and `/api/health` says which one is missing:

1. A Bright Data account with the Reddit posts dataset. Copy the API token and the dataset id.
2. **A signed DPA with Bright Data**, a transfer mechanism and your DPIA (`docs/legal/dpia.md`). Then set
   `BRIGHTDATA_DPA_SIGNED_ON` to that date (`YYYY-MM-DD`, not in the future).
3. **Bright Data's written answer on how long it keeps delivered snapshots.** Set
   `BRIGHTDATA_SNAPSHOT_RETENTION` to it, in the form `30 days` (also `hours`, `weeks`, `months`). The
   privacy notice and the sources page then state it.

| Env var                            | Value                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SOURCE_REDDIT_ENABLED`            | `true`                                                                                                                                                                                                                   |
| `REDDIT_PROVIDER`                  | `brightdata`                                                                                                                                                                                                             |
| `BRIGHTDATA_API_TOKEN`             | From Bright Data                                                                                                                                                                                                         |
| `BRIGHTDATA_REDDIT_DATASET_ID`     | Must be a dataset id pinned in `src/sources/reddit-brightdata.ts` (today `gd_lvz8ah06191smkebj4`, Reddit posts by keyword). A different id is refused. If Bright Data gives you a new id, it has to be added there first |
| `BRIGHTDATA_DPA_SIGNED_ON`         | `YYYY-MM-DD`                                                                                                                                                                                                             |
| `BRIGHTDATA_SNAPSHOT_RETENTION`    | For example `30 days`                                                                                                                                                                                                    |
| `BRIGHTDATA_COST_PER_1K`           | Your rate per 1,000 records (default 1.50)                                                                                                                                                                               |
| `BRIGHTDATA_MONTHLY_RECORD_CAP`    | Hard monthly cap across all products (default 20000)                                                                                                                                                                     |
| `REDDIT_DAILY_RECORDS_PER_PRODUCT` | Per product per day (default 120)                                                                                                                                                                                        |
| `REDDIT_DELETION_RECHECK`          | `true` (re-checks each stored post once at about 72 hours)                                                                                                                                                               |

Cost check: 120 records a day per product at $1.50 per 1,000 is about $5.40 a product a month, before
the re-check. The monthly cap stops collection when reached; `/admin/costs` shows spend.

### X (official API, paid)

1. Create an app at developer.x.com on pay-per-use and copy its Bearer Token.
2. Confirm the price per post read in the developer console. The code assumes about $0.005.
3. Set `X_BEARER_TOKEN`, `X_DAILY_READS_PER_PRODUCT` (for example `50`; `0` means no calls at all), and
   `SOURCE_X_ENABLED=true`.

Deletion compliance is built: the daily deletion sync looks every stored X post up by id and deletes
any that X no longer returns (deleted, protected, or suspended). Those lookups are post reads too:
each stored X post is looked up once a day for up to 7 days, so budget about seven times your daily
X reads for them. Check X's current developer terms before switching on; the build session could not
reach docs.x.com to confirm the lookup endpoint and its billing.

### Search links (free, on by default)

LinkedIn, Facebook, Threads and the rest are searches users open themselves; nothing is collected.
Each can be turned off with `SOURCE_<ID>_ENABLED=false`, for example `SOURCE_LINKEDIN_ENABLED=false` or `SOURCE_REDDIT_LINKS_ENABLED=false`.

## 4. Billing (Stripe, test mode)

Follow `docs/BILLING.md`. In short: `STRIPE_SECRET_KEY` (`sk_test_...`), `STRIPE_PRICE_ID`,
`STRIPE_WEBHOOK_SECRET`, and a webhook to `/api/billing/webhook`. Live mode stays locked until you work
through the live checklist in `docs/BILLING.md` yourself; the code refuses a live key unless
`BILLING_LIVE_ENABLED=true`, Managed Payments is on, and the reminder cron runs hourly (Vercel Pro).

## 5. Instant preview

On when `ANTHROPIC_API_KEY`, `APP_HMAC_SECRET` and Supabase are set. It uses Hacker News and Bluesky
only, so switch those on first.

| Env var             | Value                                        |
| ------------------- | -------------------------------------------- |
| `PREVIEW_DAILY_CAP` | Previews a day across everyone (default 200) |
| `PREVIEW_ENABLED`   | `false` turns it off                         |

## 6. Footer details (UK e-commerce rules)

`NEXT_PUBLIC_TRADING_NAME`, `NEXT_PUBLIC_TRADING_ADDRESS`, `NEXT_PUBLIC_CONTACT_EMAIL`. The footer shows
a placeholder until all three are set.

## 7. Launch switch

Before launch only the emails in `SIGNUP_ALLOWLIST` (comma separated) can sign in, every page is
`noindex`, and `robots.txt` disallows everything. One env var flips all three:

1. Set `PUBLIC_LAUNCH=true` and redeploy.
2. In Supabase > Authentication > Sign In / Providers, turn "Allow new users to sign up" back on.
3. Once the final Terms are in force, clear `terms_accepted_at` for beta accounts so they accept them.

Before you flip it, read `docs/TASKS.md` for the open `(you)` boxes. The ones that matter most for a
public launch: the solicitor's review of the legal pages (F15), the Bright Data DPA before Reddit, and
Stripe live mode if you want to take real money.

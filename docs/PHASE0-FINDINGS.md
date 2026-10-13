# Phase 0 findings

Everything I found while turning `docs/BRIEF.md` into a working foundation: contradictions, gaps and risky
assumptions, each with a proposed fix. Read "Read this first", then approve or amend the rest. Nothing past
M0 and the billing plumbing was built, on purpose: the brief says to stop for approval here.

## Read this first

**1. The biggest risk is not legal or technical. It is whether two sources produce enough signal.**
Launch coverage is Bluesky and Hacker News only. For a niche product, I would not be surprised by a handful of
relevant posts a week, and a Reply feed that is empty most days is a product people cancel after the trial. The
Build tab "has to earn the subscription" on thin data, and themes with a count of two are not themes. Before
spending on M2 to M5, run a throwaway spike: take ten real products (yours and friends'), query both sources
for their obvious phrases over the last 30 days, and count posts a human would call worth replying to. If the
median product gets fewer than about five a week, change the plan (more sources, a lower price, a different
promise) before building the pipeline. I did not run this because the hosts are not on the allowlist yet, and
the standing rule is that nothing calls a host that is not.

**2. Stripe is not connected, and I could not verify the merchant-of-record path.**
The Stripe connector needs you to authorize it in your claude.ai connector settings; I cannot do that from here.
So no Stripe objects exist yet. Separately, the hard rules require a merchant of record. The checkout code turns on
Stripe Managed Payments (`managed_payments: { enabled: true }`, which I confirmed exists in the Stripe SDK's
types), but whether your account is eligible, what it costs, and how it treats trials, tax-inclusive display and
the billing portal are things I could not read: `docs.stripe.com` is not reachable from this sandbox. Confirm
eligibility before anything else in billing. If you are not eligible, the fallback in the brief is Paddle, and
the billing code is built behind small interfaces so that swap is contained.

**3. Do not take money yet.** The legal pages are placeholders, there is no Terms, no removal form, no ICO fee
paid, no DPIA, no DPAs signed, and the brief itself says to get the checklist reviewed by a UK solicitor first.

## Changes I made beyond the brief (need your approval)

The brief says to ask before changing stored fields, billing or the processor list. These were needed to make
billing work at all, so I made them and am flagging them.

- **`profiles` gained billing columns:** `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`,
  `current_period_end`, `cancel_at_period_end`, `trial_reminder_sent_at`, `billing_event_at`, plus
  `marketing_opt_in_at` (PECR needs proof of when consent was given). Users cannot write any of them; only the
  Stripe webhook can, through a service-role-only function.
- **New table `billing_events`:** one row per Stripe event id, for idempotency. Server-only.
- **Two SQL functions** (`apply_billing_patch`, `claim_billing_event`), callable by the service role only.
- **A processor host list** (`src/server/net/hosts.ts`): see item 7.
- **Stripe, Resend and Supabase SDKs added** as dependencies, and the `server-only` package.
- **`themes.example_post_ids` capped at 3** and **`posts.source` limited to the two collected sources** by check
  constraints. Adding X in phase 2 needs a migration.

## Contradictions, gaps and risky assumptions

### Money and billing

1. **Managed Payments eligibility is unverified.** See above. Proposed fix: you check eligibility in the Stripe
   Dashboard before anything else; if ineligible, decide on Paddle before M6 proceeds.
2. **"Full price up front, tax included where it applies" versus a flat $29.** Whether Managed Payments shows tax
   inclusive for UK and EU buyers is a MoR behavior I could not read. Proposed fix: decide the price per region
   with the Managed Payments docs open, and put the answer in `docs/claims.md` before the pricing page ships.
3. **The 48 hour reminder needs an hourly cron, and Vercel's Hobby plan only runs crons daily.** A daily run
   lands the email 24 to 48 hours before the charge, which misses the brief's number. Vercel's Hobby plan is also
   for non-commercial use under their terms (check their current terms), so a paid product belongs on Pro anyway.
   Stripe's own `customer.subscription.trial_will_end` event fires about three days out, so it cannot replace
   this job. Proposed fix: Vercel Pro (`vercel.json` already declares the hourly cron).
4. **`past_due` access is undecided.** I defaulted to no access the moment a card fails, which is safe but harsh
   for a transient decline. Proposed fix: decide a grace period, for example access while Stripe is still retrying.
   It is one constant (`ENTITLED_STATUSES`).
5. **Cooling-off and consent.** Under the Consumer Contracts Regulations a digital service started during the
   cancellation period usually needs the customer's express request to start and acknowledgement of what that
   does to their refund rights. The brief says "state them plainly in the terms" but not how consent is captured
   at checkout. I did not add a checkbox, because Stripe's terms-of-service consent needs a Terms URL configured in
   the Dashboard first. Proposed fix: solicitor advice, then add consent to the checkout (M6 task).
6. **Account deletion versus financial records.** Deleting an account cancels the subscription and deletes our
   rows (tested: cascades work), but invoices and the Stripe customer record may need to be kept for tax law.
   Proposed fix: state the retention in the privacy notice and decide whether the Stripe customer is deleted.

### Compliance model

7. **"CI fails if code calls any other host" would also fail Stripe, Supabase, Resend and Anthropic.** The brief
   defines an allowlist for data sources only. I added a separate, documented list of processor hosts that are
   reached only through their official SDKs. Proposed fix: approve the list, and keep it equal to the processors
   in the privacy notice.
8. **Playwright versus "no Playwright against third-party sites".** The denylist allows Playwright as a dev
   dependency only (CI enforces dev-only). That the E2E tests only hit localhost is a convention that nothing
   enforces yet. Proposed fix: the M1 task adds an E2E base URL guard that refuses any non-localhost URL.
9. **The logo rule is only enforced by file name.** An inline SVG or base64 logo would pass the copy gate.
   Proposed fix: leave the gate as is and keep the compliance-reviewer checklist item.

### Data sources and the pipeline

10. **Bluesky access is unverified, and may change the design.** The brief says "check current auth rules before
    building". If search needs authentication, AskedFor holds a Bluesky credential as a server secret and runs
    searches as an account, which sits uneasily with "no automated interactions" and needs a public contact email
    someone monitors. "Drop posts deleted at source" also needs a deletion-check method, which means extra reads.
    I did not guess hosts; the registry is empty of collect sources and the first M2 task is to confirm them.
11. **Instant preview conflicts with three other rules.** It collects posts for a stranger's URL before sign-up
    ("nothing is collected before the user confirms"), stores results for 24 hours (there is no table for that
    in the core list), needs per-IP rate-limit data, and lets an anonymous visitor spend your model budget. Show HN
    depends on it. Proposed fix: add a `preview_runs` table with a 24 hour purge, hash IPs, cap global daily model
    spend, put a bot check in front of it (a third-party processor to add to the DPA list), and decide whether
    the preview collects live or serves a cached sample.
12. **Success metrics need event data that the data model does not have.** Activation, weekly actives and replies
    per user need events. The privacy rules allow only cookieless analytics. Proposed fix: a minimal first-party
    `events` table (user id, event name, time, nothing else) rather than a third-party tool. I did not add it.
13. **Build tab "no names or quotes" versus model-written summaries.** A model can quote a post inside a theme
    summary. The schema keeps `summary` text, so after the posts are purged the quote would remain. Proposed fix:
    an overlap check that rejects any summary sharing a long phrase with a source post (an M5 test).
14. **Classifier refusals.** Haiku 5.5 can return `stop_reason: refusal` and has no server-side fallback. The
    classifier must treat that as "unclassified", never as an error that drops the batch. Proposed fix: an M3
    task and test.

### Operations

15. **Supabase organization is on the Free plan.** No backups, projects pause after inactivity, which for a paid
    product is an outage. Free also allows two active projects and you now have two. Proposed fix: upgrade to Pro
    before real users. It is also needed to see whether the DPA is available on your plan; check that.
16. **The existing Supabase project is in Ireland (`eu-west-1`), not London.** I created a new London project
    (`askedfor`, ref `hoqbflkszzoojdswbrgy`) and did not touch the old one. Proposed fix: if it is empty, pause or
    delete it.
17. **Supabase Auth is not configured.** Magic links need custom SMTP (Supabase's default is rate-limited and
    not for production), and Google sign-in needs an OAuth client. Proposed fix: M1 prerequisites, listed in
    `docs/TASKS.md`.
18. **The Monday digest is "UK morning" but Vercel crons run in UTC.** Seven o'clock UTC is 7 or 8 in the UK. For
    an email this is minor. Proposed fix: run at one UTC time and accept the one-hour drift, or schedule both and
    make the job idempotent.

### Claims

19. **Some of the brief's own claims need shipped behavior behind them first.** "Without scraping", "we delete raw
    posts after 30 days" and "we never post for you" are promises. The first is backed by the hosts gate. The
    second needs the M2 purge job, tested, before the sentence is published. Proposed fix: list each in
    `docs/claims.md` with a pointer to its test, and publish none before its test exists.
20. **The brief's own text breaks its copy rules** (UK spellings such as "labelled", "minimisation"). That is fine
    for an internal brief; the copy gate only scans marketing pages and emails, where US English is enforced.

## What I could not do or verify

- Connect Stripe or create any Stripe object. Needs your authorization.
- Read Stripe's Managed Payments docs (host unreachable from the sandbox).
- Run the GitHub Actions workflow. It is written and its steps all pass locally; whether it is green on GitHub is
  checked after the push.
- Deploy to Vercel, buy domains, run the trademark search, pay the ICO fee, write the LIA or DPIA, sign DPAs.
- Fetch the Supabase secret key. It is not exposed to me, and should not be. Set `SUPABASE_SECRET_KEY` yourself.

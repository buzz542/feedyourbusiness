# Tasks

Each task has a box and an acceptance test. The test is written first and decides "done" (see CLAUDE.md,
"The loop"). Tick a box only when its test passes, `npm run check` exits 0, and the compliance-reviewer
subagent has no blocking findings. One focused commit per task.

Run one goal per milestone, in auto mode. Switch to manual mode for anything touching billing, production
secrets or the live database.

Legend: `[x]` done and verified. `[ ]` not done. `(you)` means it needs the founder.

---

## M0 Foundations

```
/goal Milestone M0 in docs/TASKS.md is complete: every M0 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M0's scope changed. Or stop after 30 turns and list what is left.
```

- [x] Next.js App Router, TypeScript strict, Tailwind. Test: `npm run build` succeeds with no secrets in the environment, and the production server answers every page with 200.
- [x] Supabase project in London. Test: project `askedfor` is `ACTIVE_HEALTHY` in `eu-west-2`; security advisors report no findings.
- [x] Core schema, RLS and grants as migrations. Test: `tests/db/schema.test.ts` against real Postgres: RLS on every table, `anon` has no privileges, users cannot read each other's rows or write billing columns, retention is capped at 30 days, the audit log is append-only. Mutation-checked: five deliberate breakages each fail the suite.
- [x] Billing functions `apply_billing_patch` and `claim_billing_event`. Test: `tests/db/billing-functions.test.ts` covers stale events, redelivery, explicit nulls, reminder re-arming and service-role-only access.
- [x] `npm run check` runs typecheck, lint, format check and every test.
- [x] Source contract, registry and link-mode sources. Test: `src/sources/registry.test.ts`; platforms the rules forbid collecting are link-only; no host is allowed yet.
- [x] `safeFetch`. Test: `src/server/net/safe-fetch.test.ts` proves a host off the allowlist is blocked without touching the network, including lookalikes, userinfo tricks, private IPs, non-https, odd ports and redirects off the allowlist.
- [x] Four CI gates (`compliance:hosts`, `:deps`, `:schema`, `:copy`). Test: `compliance/lib/scanners.test.ts` plants a violation of each rule and expects it caught; eleven violations were also planted in the real repo and every one failed its gate.
- [x] Placeholder legal pages (privacy, terms, acceptable use, cookies, remove my post) and footer. Test: all return 200 and pass `compliance:copy`.
- [x] Claude Code hooks (install denylist, format and lint, stop check, session start), two review subagents, path-scoped rules. Test: `tests/hooks/hooks.test.ts` runs the hooks as Claude Code does.
- [x] CI workflow in `.github/workflows/ci.yml`.
- [ ] CI is green on GitHub on an empty app. Test: the `check` job passes on the pushed branch.
- [ ] (you) Vercel project connected to the repo, with environment variables from `.env.example`. Test: a preview deploy serves the placeholder site.
- [ ] (you) Supabase Auth settings: site URL, redirect URLs, Google provider, custom SMTP through Resend. Test: a magic link arrives and signs in (M1).
- [ ] (you) Move the Supabase organization to Pro before real users: backups, no auto-pause. Test: dashboard shows the Pro plan.
- [ ] (you) Decide what to do with the older `buzz542's Project` in `eu-west-1`, which is not London. Test: paused or deleted, or confirmed unused.

## M1 Onboarding

```
/goal Milestone M1 in docs/TASKS.md is complete: every M1 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M1's scope changed. Or stop after 30 turns and list what is left.
```

- [ ] Sign-in with magic link and Google through Supabase Auth. Test: e2e on localhost signs in; an unauthenticated request to an app route redirects to sign-in.
- [ ] `fetchOwnSite()` with SSRF protection: https only, no private or local IPs (resolved, not just by name), size and time limits, no redirects off the domain. Test: refuses `http://`, `https://127.0.0.1`, a hostname that resolves to a private IP, a redirect to another domain, and an oversized body.
- [ ] `src/server/llm/` wrapper: JSON schema outputs, logged token usage, handles `stop_reason: refusal`. Test: schema-invalid output is rejected; usage is recorded per call.
- [ ] Draft profile from a URL: name, what it does, audience, competitors, 20 to 30 search terms. Test: draft appears within 2 minutes on a fixture site.
- [ ] Every field editable; nothing collected before confirm (`products.status` stays `draft`). Test: a collector run on a draft product stores nothing.
- [ ] Add Playwright as a dev dependency with `npm run test:e2e`, pinned to localhost. Test: the e2e base URL guard refuses any non-localhost URL.

## M2 Collection

```
/goal Milestone M2 in docs/TASKS.md is complete: every M2 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M2's scope changed. Or stop after 30 turns and list what is left.
```

- [ ] First: confirm Bluesky and Hacker News access against the current official docs (hosts, auth, rate limits, terms) and record the date. Test: the module header cites the doc pages; hosts are added to the registry only now. If Bluesky search needs authentication, record the decision with the founder first.
- [ ] Hacker News collector (Algolia search, Firebase existence check). Test: fixture tests; stops at `dailyBudget`; always stores a link back.
- [ ] Bluesky collector. Test: fixture tests; drops posts deleted at source; respects the developer guidelines checklist.
- [ ] Suppression list honored on every write path. Test: a suppressed author is never stored.
- [ ] Retention purge job (daily): deletes posts past `delete_after`, clears `themes.example_post_ids`. Test: fixture posts older than 30 days are purged; themes lose their example ids.
- [ ] Deletion sync. Test: a post deleted at the source is deleted here.
- [ ] Jobs table and Vercel Cron routes that work in batches. Test: a run that would exceed the function time limit resumes on the next tick.
- [ ] Per-source kill switches wired to the runner. Test: `SOURCE_<ID>_ENABLED=false` stops that source within one run.

## M3 Classifier

```
/goal Milestone M3 in docs/TASKS.md is complete: every M3 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M3's scope changed. Or stop after 30 turns and list what is left.
```

- [ ] Output schema: relevance 0 to 100, category, one-line reason. Test: output always validates; the schema has no sensitive-trait fields; prompts never ask for them.
- [ ] Haiku 5.5 classification with prompt caching on the product profile. Test: `cache_read_input_tokens` is above zero on the second call.
- [ ] Dedupe. Test: the same post from two search terms yields one `product_posts` row.
- [ ] Precision on 100 posts you label by hand is at least 0.8 at the default threshold. Test: eval script prints precision; replace the cost table in the PRD with measured numbers.

## M4 Reply tab

```
/goal Milestone M4 in docs/TASKS.md is complete: every M4 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M4's scope changed. Or stop after 30 turns and list what is left.
```

- [ ] Today and All views with category and source filters. Test: 200 items load in under 1.5 seconds.
- [ ] Save, replied, hide. Test: marking Replied removes a post from Today.
- [ ] Cards show source, age, category, excerpt and a link to the original. Test: component test on a fixture.
- [ ] "Say you built it." on every reply surface. Test: the compliance-reviewer finds none without it.
- [ ] Reply tips (never drafted replies). Test: no code path calls a model to write reply text.
- [ ] Search links per term for the link-mode sources. Test: links open on the declared hosts only.

## M5 Build tab

```
/goal Milestone M5 in docs/TASKS.md is complete: every M5 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M5's scope changed. Or stop after 30 turns and list what is left.
```

- [ ] Weekly themes with count and trend, up to 3 linked excerpts each. Test: themes regenerate weekly; trend uses the previous week's stored counts.
- [ ] "Leaving [competitor] because" and "wished it existed" views.
- [ ] No author names anywhere in the Build tab. Test: render with fixture data containing handles; none appear in the output.
- [ ] Theme summaries contain no quotes from posts. Test: an overlap check against source text rejects a summary that copies a post.
- [ ] Markdown export.
- [ ] Monday digest email with a working unsubscribe link. Test: link unsubscribes; UK-time scheduling is correct across the daylight saving change.

## M6 Billing

```
/goal Milestone M6 in docs/TASKS.md is complete: every M6 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M6's scope changed. Or stop after 30 turns and list what is left.
```

- [x] Checkout Session builder: 7-day trial, card required, trial cancels if no card is left, renewal terms on the payment page, Managed Payments on. Test: `src/server/billing/checkout.test.ts`.
- [x] Webhook: signature verified on the raw body, bounded body size, idempotent, ordering-safe (subscription state is re-fetched, stale patches dropped). Test: `events.test.ts`, `handlers.test.ts`, `tests/db/billing-functions.test.ts`; verified against a running production server with a correctly signed, a forged and a tampered request.
- [x] No second subscription while one is live (including past_due). Test: `handlers.test.ts`.
- [x] Cancel and resume handler for the two-click flow, plus billing portal link. Test: `handlers.test.ts`.
- [x] Trial reminder 48 hours before the first charge. Test: `trial-reminders.test.ts` simulates a whole trial hour by hour: exactly one reminder, 47 to 48 hours before, none after a cancel, retried after an email failure, re-armed if the trial is extended.
- [x] Live mode locked: a live key needs `BILLING_LIVE_ENABLED=true` and Managed Payments on. Test: `config.test.ts`.
- [ ] (you) Authorize the Stripe connector, confirm Managed Payments eligibility, create the product and price in test mode. Test: `docs/BILLING.md` steps 1 to 4.
- [ ] (you) Register the webhook endpoint and set the env vars. Test: a Stripe CLI `stripe trigger customer.subscription.created` returns 200.
- [ ] Settings page: plan, renewal date, cancel in two clicks, update card. Test: e2e in test mode.
- [ ] Price, renewal and cancellation terms on the pricing page before checkout, tax included where it applies. Test: copy gate passes; every number is in `docs/claims.md`.
- [ ] Express consent to start the service during the cancellation period, per solicitor advice. Test: recorded with the subscription.
- [ ] Account deletion and data export. Test: end to end in test mode, including cancelling the subscription.
- [ ] Vercel Pro and the hourly cron live (`vercel.json` already declares it). Test: the cron route returns 200 hourly in the logs.
- [ ] Resend domain verified and `EMAIL_FROM` set. Test: a real reminder arrives.
- [ ] (you) Run test-mode payments end to end, then switch to live yourself. Test: the live checklist in `docs/BILLING.md`.

## M7 Launch surface

```
/goal Milestone M7 in docs/TASKS.md is complete: every M7 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M7's scope changed. Or stop after 30 turns and list what is left.
```

- [ ] Landing page per the brief's spec, with labeled example data. Test: copy gate passes; every claim has a row in `docs/claims.md`.
- [ ] Instant preview (see `docs/PHASE0-FINDINGS.md`, item 11 before building this). Test: rate-limited per IP; keeps nothing past 24 hours.
- [ ] Final legal pages, reviewed by a UK solicitor or compliance service (you).
- [ ] "Remove my post" form with an admin queue. Test: one admin click deletes and suppresses; audit log records it.
- [ ] Sources page. Test: lists exactly the registry.
- [ ] Remove `robots` disallow and `noindex` at launch.
- [ ] (you) Pre-launch checklist from the brief.

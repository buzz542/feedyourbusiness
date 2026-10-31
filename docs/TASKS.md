# Tasks

The checklist for `docs/PLAN.md`. Each box has an acceptance test, written first, that decides "done" (see
CLAUDE.md, "The loop"). Tick a box only when its test passes, `npm run check` exits 0, and the reviewers have
no blocking findings. One focused commit per box. Section numbers like (7.4) point into `docs/PLAN.md`.

Run one goal per milestone, in auto mode. Switch to manual mode for anything touching billing, production
secrets or the live database. Every migration box: apply to the development project with the advisors clean,
then ask the founder before applying it to production (`docs/PLAN.md`, section 0, item 7).

Legend: `[x]` done and verified. `[ ]` not done. `(you)` needs the founder; the F-numbers are the steps in
`docs/PLAN.md` section 15. When a box needs a key or service the session does not have, build and test it
with fakes and fixtures, tick the build box, and leave the live check in the matching `(you)` box.

## Launch order

The founder set this order on 31 Oct 2026. It changes the order of the milestones below, not their scope or
acceptance tests. Work Launch 1 first, then 2. Every subscription gets the same four collect sources: Hacker
News, Bluesky, Reddit and X. No other platform is added (section 2 still applies).

**Launch 1: the Reply tab with four sources.**

1. Finish M2 (model wrapper, drafts, onboarding UI).
2. M3: migration, contract v2, author hashing, jobs and crons, Hacker News, Bluesky, Reddit, X, the collect
   step, purge and deletion sync, kill switches and caps, Reddit rotation, the `sources` health check.
   Reddit goes live only when 2.1.7 holds (F8 and its paperwork). X goes live only after F18, its deletion
   compliance in `checkDeleted`, and a founder-confirmed `X_DAILY_READS_PER_PRODUCT` (see section 18).
3. M4: migration, schema and guard, classification, caching, dedupe, spend caps. The eval script can follow.
4. M5: everything except keyboard shortcuts and the 200-card performance test, which can follow.
5. M8: every build box.
6. M9: migration `launch` only if the preview ships; landing, sources page, `/bot`, remove-my-post and its
   admin queue, legal drafts, security headers, the launch switch. Admin metrics and the instant preview
   can follow.

**Launch 2: the upgrade.** M6 (Rivals), M7 (Build) and everything deferred above.

---

## M0 Foundations

```
/goal Milestone M0 in docs/TASKS.md is complete: every M0 box not marked (you) is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M0's scope changed. Or stop after 30 turns and list what is left.
```

- [x] Next.js App Router, TypeScript strict, Tailwind. Test: `npm run build` succeeds with no secrets in the environment, and the production server answers every page with 200.
- [x] Supabase project in London. Test: project `askedfor` is `ACTIVE_HEALTHY` in `eu-west-2`; security advisors report no findings.
- [x] Core schema, RLS and grants as migrations. Test: `tests/db/schema.test.ts` against real Postgres: RLS on every table, `anon` has no privileges, users cannot read each other's rows or write billing columns, retention is capped at 30 days, the audit log is append-only. Mutation-checked: five deliberate breakages each fail the suite.
- [x] Billing functions `apply_billing_patch` and `claim_billing_event`. Test: `tests/db/billing-functions.test.ts` covers stale events, redelivery, explicit nulls, reminder re-arming and service-role-only access.
- [x] `npm run check` runs typecheck, lint, format check and every test.
- [x] Source contract, registry and link-mode sources. Test: `src/sources/registry.test.ts`; platforms that are never collected are link-only; no host is allowed yet.
- [x] `safeFetch`. Test: `src/server/net/safe-fetch.test.ts` proves a host off the allowlist is blocked without touching the network, including lookalikes, userinfo tricks, private IPs, non-https, odd ports and redirects off the allowlist.
- [x] Four CI gates (`compliance:hosts`, `:deps`, `:schema`, `:copy`). Test: `compliance/lib/scanners.test.ts` plants a violation of each rule and expects it caught; eleven violations were also planted in the real repo and every one failed its gate.
- [x] Placeholder legal pages (privacy, terms, acceptable use, cookies, remove my post) and footer. Test: all return 200 and pass `compliance:copy`.
- [x] Claude Code hooks (install denylist, format and lint, stop check, session start), two review subagents, path-scoped rules. Test: `tests/hooks/hooks.test.ts` runs the hooks as Claude Code does.
- [x] CI workflow in `.github/workflows/ci.yml`.
- [x] CI is green on GitHub on an empty app. Test: the `check` job passes on the pushed branch.
- [x] Deploys work on Vercel's Hobby plan: daily-only crons, functions in London (`lhr1`), Node pinned to 22.x. Test: `tests/deploy/vercel-config.test.ts` (rejects hourly and sub-daily schedules, checks every cron route exists and checks `CRON_SECRET`, region, Node version matches `.nvmrc`).
- [x] `/api/health`: liveness without credentials; with `Authorization: Bearer $CRON_SECRET`, checks site URL, Supabase (real query), Stripe config, price and webhook endpoint, and email, without returning any secret. Test: `src/server/health/checks.test.ts`; verified on a local production build.
- [x] Guardrails rebaselined for route C (`docs/PLAN.md`, D1): CLAUDE.md, rules, compliance reviewer, registry test (Reddit can be collected through the vendor, never fetched directly), Reddit link source renamed `reddit_links`. Test: `src/sources/registry.test.ts`, `tests/compliance/hosts.test.ts`, `tests/hooks/hooks.test.ts`.
- [ ] (you) F1: reconnect the Vercel connector with the "buzz542's projects" scope.
- [ ] (you) F3: Vercel project imported, Production Branch set, env vars added. Test: a deploy serves the placeholder site and `GET /api/health` answers `{"status":"up"}`.
- [ ] (you) F4 and F5: Supabase secret key; Auth URLs (no `*.vercel.app` wildcard on production), "Allow new users to sign up" off until launch, Google provider, then SMTP through Resend. Test: a magic link arrives and signs in (M1); with sign-ups off, Google signs in to an account an email link created, and a Google account with no AskedFor account sees "use an email link first".
- [ ] (you) F17: Supabase Pro before real users; decide on the old `eu-west-1` project.

## M1 App shell and auth

```
/goal Milestone M1 in docs/TASKS.md is complete: every M1 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M1's scope changed. Or stop after 40 turns and list what is left.
```

- [x] Migration `profiles_app` (6.1). Test: `tests/db/profiles-app.test.ts`: a user cannot set `is_admin` or any billing column on their own row; can set `email_daily`, `email_weekly`, `terms_accepted_at`; `events` is invisible to anon and authenticated. Also: no API role (service role included) can write `is_admin`; `terms_accepted_at` is stamped by the database once, a second accept is a no-op, and it cannot be cleared. Mutation-checked: four planted weakenings each fail the suite. Types in `src/types/database.ts` edited by hand to match.
- [ ] (you) Apply `profiles_app` to the development project once F12 creates it (advisors clean), then to production after you say yes; regenerate `src/types/database.ts` and rename the file to the version Supabase records. Both Supabase projects were paused on 24 Oct 2026.
- [x] Copy rules also cover app UI (`src/app/(app)`, `src/app/(admin)`, `src/components`): em dashes, banned phrases, UK spellings, competitor names, but not the claims-number rule. Test: planted violations in a fixture app file are caught; a number in app copy is not flagged; `npm run compliance:copy` passes on the repo. Also: the gate is run on a planted repo tree (every app root read, test files skipped), the root layout is public scope, and any `.tsx` under `src/app` or `src/components` outside every scope fails the gate.
- [x] Design system (9.2 to 9.4): `geist` and `@fontsource-variable/fraunces`, new tokens, components in `src/components/ui/`. Test: contrast test computes at least 4.5:1 for every text pair in both themes; render tests for `Highlight` (exactly the given range wrapped in `<mark>`, safe on out-of-range offsets), `Button`, `Chip`, `Card`, `Tabs`, `EmptyState`, `Sparkline`. Also: `compliance:hosts` refuses `next/font/google` and remote URLs in stylesheets (planted). `Dialog`, `Toast`, `Tag` and `Skeleton` arrive with the first screen that needs them (M5).
- [x] Sign-in (12.1, 12.10): `/login` with magic link and Google, the 18+ and terms confirmations, `/auth/callback` (PKCE exchange), sign out, and the pre-launch `SIGNUP_ALLOWLIST` (anyone else sees "AskedFor is in private beta" and no account is created). Test: an email not on the allowlist gets no account; `safeNextPath` unit tests (`//evil.example`, `https://evil.example`, `/\evil.example`, encoded forms all fall back to `/app`; `/app/rivals?x=1` is kept); terms acceptance is stored once (`tests/db/profiles-app.test.ts`). Also: Supabase sign-ups stay off until launch and the server creates accounts only for allowlisted emails (F5); off-list accounts are refused at the callback, on every app page and at checkout, and deleted only when created in the last 10 minutes and never used; the callback takes an email token hash on a local dev server only (it skips PKCE, so in production it would allow login CSRF); session cookies are httpOnly, and Secure on https. Verified on a production build in Chromium: an off-list email gets the private-beta message and no request leaves localhost.
- [x] `src/proxy.ts` (Next 16 proxy): session refresh, protects `/app` and `/admin`, skips webhook, cron, health and static paths. Test: unit tests of the routing decision (anonymous `/app/x` goes to `/login?next=/app/x`; `/api/billing/webhook` passes untouched; a non-admin on `/admin` gets 404). Also: `/auth/callback` is skipped, a server-action POST passes to the page's own check, and the session check fails closed. Verified on a production build: `/app/x` 307 to `/login?next=%2Fapp%2Fx`, `/admin` 404, health and webhook untouched.
- [x] App frame and next-step routing (9.5, 4.2): `(app)` layout with tabs, product name and account menu; `/app` sends the user to onboarding, billing or Reply. Test: `nextStepFor()` covers every case (terms not accepted, no product, draft product, not entitled, `past_due`, entitled). Also: every app page checks the user itself (allowlist and terms), placeholder pages stand in for each step until its milestone, and the frame was checked at 375px and in dark mode.
- [x] Server-side `track(name, userId, props)` for `events` (12.6). Test: unknown event names and props that look like emails, URLs or long text are refused; nothing is sent to a third party. Also: props are a fixed set of typed keys and nothing else (planted: bare community names, post ids, usernames, unknown keys); written with the service role, server-side only; `signed_up` is recorded once, at the first terms acceptance.
- [x] Playwright E2E harness: `@playwright/test` (dev), `npm run test:e2e`, base URL guard (localhost only), sign-in helper that creates a confirmed user with the admin API and follows a generated magic link, cleanup. Test: the guard refuses any non-localhost URL (unit test); the sign-in E2E lands on `/app/onboarding` when `SUPABASE_SECRET_KEY` is present and is skipped with a clear message when it is not. Ran: the two anonymous E2E tests pass and sign-in is skipped until F12. Also: the browser may load localhost only (every other request is aborted), `.env.local` is read before the production guard, and `compliance:deps` now reads the lockfile the way npm writes it (planted).
- [ ] (you) F12: session secrets and allowed hosts, so E2E runs in the session.

## M2 Onboarding

```
/goal Milestone M2 in docs/TASKS.md is complete: every M2 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M2's scope changed. Or stop after 40 turns and list what is left.
```

- [x] Migration `onboarding` (6.2). Test: `tests/db/onboarding.test.ts`: competitors RLS for owner and another user; a second product for the same owner is refused, and the owner cannot delete the product (so limits never reset); existing `products.competitors` values move to `competitors` (trimmed, cut to 80, case duplicates merged) before the column is dropped, and the migration stops instead of losing a name or when an owner has two products; handles, emails, URLs and profile links without a scheme (`x.com/name`, `linkedin.com/in/name`, `reddit.com/user/name`, `github.com/name`, `bsky.app/profile/name`, `name.bsky.social`) are refused in competitor names, aliases and search terms (padded, invisible and fullwidth forms too) while `Cal.com` and `Menu/Tabs` are accepted and `u_` profiles in subreddits, from any role; `confirmed_at` is stamped by the database, cannot be written or backdated by the owner, and a confirmed product cannot go back to draft; names are unique ignoring case through `name_key`, the conflict target supabase-js can name; at most 20 competitors and 40 terms per product from any role, with a duplicate at the cap still a no-op; `llm_usage` is append-only for the service role; the label checks are in the unexposed `private` schema; `search_terms.intent` defaults to `problem`; `llm_usage` is invisible to API roles; a product with no URL is accepted and an `http://` URL is still refused; every limit is tested on both sides.
- [ ] (you) Apply `onboarding` to the development project once F12 creates it (advisors clean), then to production after you say yes. Destructive: it drops `products.competitors` (production has never used it), the `products_owner_id_idx` index and the owner's delete right on products. Then regenerate `src/types/database.ts` and rename the file to the version Supabase records.
- [x] `fetchOwnSite()` (12.3) and the hosts-gate exception for `src/server/net/own-site.ts` only. Test: refuses `http://`, `127.0.0.1`, `::1`, `169.254.169.254`, `10.0.0.1`, `192.168.1.1`, `100.64.0.1`, `fc00::1`, `::ffff:127.0.0.1`, a hostname whose resolver returns a private address, a redirect to another domain, a 3 MB body and a non-HTML type, and every platform host in `src/server/net/platform-hosts.ts` (planted: `https://www.reddit.com/r/x`, `https://old.reddit.com`, `https://redd.it/a`, `https://x.com/a`, `https://t.co/a`, `https://www.linkedin.com/in/a`, `https://lnkd.in/a`, `https://youtu.be/a`, `https://bsky.app/profile/a`, `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=a`, `https://news.ycombinator.com/item?id=1`, `https://hn.algolia.com/api/v1/search?query=a`, `https://www-reddit-com.translate.goog/r/x`, `https://web.archive.org/web/2026/https://www.reddit.com/`), as the first URL and as a redirect target, and any URL whose path or query embeds another URL or names a platform or third-party domain (planted: `https://r.jina.ai/https://www.g2.com/products/a/reviews`, a double-encoded `reddit%252Ecom`), and a host that embeds a platform domain; every third-party host category in `src/server/net/third-party-hosts.ts` (planted per category: `https://apps.apple.com/us/app/a/id1`, `https://github.com/a/b`, `https://www.npmjs.com/package/a`, `https://www.g2.com/products/a/reviews`, `https://www.capterra.com/p/1/a/`, `https://www.trustpilot.com/review/a.example`, `https://medium.com/@a`, `https://mastodon.social/@a`, `https://linktr.ee/a`) and a profile path on any host (`https://acme.example/@a`, `/u/a`, `/user/a`, `/profile/a`, `/in/a`, `/people/a`); follows a same-host redirect; a private answer at connect time is refused (DNS rebinding); only `fetchOwnSite` and its factory are exported, and the gate refuses a re-export of `node:https` or `node:dns` from `own-site.ts` (planted); the gate still fails `node:https` or `node:dns` imported anywhere else (planted).
- [x] Onboarding input (8.3 step 1). Test: a site URL, a bare domain, an `http://` link (upgraded once) and a description are each classified right, with query and fragment dropped; every planted platform link from the `fetchOwnSite()` box, a link on each third-party host category, a profile path, an email address and text with `@name` or `u/name` are refused before any fetch with the "We can only read your own website" message.
- [x] Site reader and page text (8.3 step 2). Test: with a fixture site of 10 pages it fetches the pasted page plus at most 5 same-site pages in the keyword order, never another host (planted: links to the product's X, LinkedIn and Product Hunt pages and to a partner site are not followed) and never a page whose path has a people or non-product word, even when it also has a wanted one (planted: `/about/team`, `/blog/new-features`, `/customers/pricing-story`); words match whole path words (`/devs` is not `vs`); a `robots.txt` that disallows a page keeps it unfetched, a 4xx allows every page, and a 5xx, a timeout or a refused redirect reads no extra pages; the robots group is matched on the exact `AskedFor` token (planted: an empty `User-agent:` line and a substring token do not count); at most 7 requests when every extra page fails; a redirect to a people or disallowed path is discarded; a pasted people page is replaced by the home page; text comes without scripts, styles, navigation or footers, each page under its own header, 30,000 characters in all, the pasted page first; one page failing does not stop the rest; the 30 second budget stops it.
- [x] `src/server/llm/` (8.1) with `@anthropic-ai/sdk`. Test (fake client): schema-invalid output is retried once and then rejected; `stop_reason: "refusal"` raises `LlmRefusalError`; every call writes one `llm_usage` row with the computed cost; cached system blocks carry `cache_control`; spend caps stop calls; a static scan of `src/`, `scripts/` and `eval/` fails on any tool `type` with an 8-digit date suffix, on `mcp_servers` and `mcp_toolset`, and on `WebSearch` and `WebFetch` and on any import of `@anthropic-ai/claude-agent-sdk` or a `tools`, `tool_choice` or `container` property next to the Anthropic SDK (planted in a fixture file each). Also, after review: every attempt reserves its place in Postgres first (`llm_begin_call`, one lock, open reservations counted), so parallel requests cannot pass a cap or the drafting limit; a call that throws is recorded (estimated input) and raises `LlmUnavailableError` with no API text; a deadline covers both attempts with no SDK retries; the SDK is pinned to `api.anthropic.com` with logging and tracing off whatever `ANTHROPIC_BASE_URL`, `ANTHROPIC_LOG` or the OpenTelemetry vars say (planted).
- [x] Draft from the site (8.3 step 3). Test: with a fixture site and a fake model the draft is saved into the `draft` product with 20 to 30 terms and its competitors with domains and aliases (`origin = 'draft'`) in under 2 minutes; no job is created while the product is a draft; suggested subreddits on the sensitive-community list and any starting with `u_` are dropped (planted); a competitor domain on a platform host is dropped (planted); a handle, an email or a URL is rejected in every text field, terms and aliases included (planted in each); the system prompt has the products-not-people and never-infer rules; the seventh draft call for a product in a UTC day (a retry counts) is refused before it is made, counted from the first because the product row exists before the call. Also, after review: the limit is checked before any page is read and reserved atomically before every model call (the sixth call is made, its retry as the seventh is refused; two parallel drafts with one call left make one call); 45 seconds for the model, so a slow model ends in under 2 minutes with `unavailable` (fake clock); answers are parsed leniently and `cleanDraft` enforces every length and count; competitors with the same name are merged; the url is saved with the draft, and a double-click on the first paste gets one product; the sensitive-community list gained the communities review found missing, one planted per category, and keeps `hospitality`, `stories` and `selection`.
- [x] Draft from a description when there is no site or it cannot be read. Test: same output contract; with neither site text nor a description the model is not called and the user is asked for a sentence.
- [ ] Onboarding UI (4.3): one box, progress by step, "Here's what we found" with "Looks right" as the one click, "Change something" for optional edits, "Not my product?". Test: E2E on localhost with fake services (`E2E_FAKE_SERVICES=1`, honored only when `VERCEL_ENV` is unset and the site URL is localhost; a unit test proves it is refused otherwise): paste a link, see the found screen, one click sets `active` and the database stamps `confirmed_at`; a description works the same way; a platform link shows the refusal and fetches nothing; edits under "Change something" persist, and a subreddit the user adds that is on the sensitive-community list is refused with a message; "Not my product?" drafts again into the same product; checked at 375px and in dark mode.
- [ ] (you) F13: Anthropic key. Then one real draft on your own product URL, checked by you.

## M3 Collection

```
/goal Milestone M3 in docs/TASKS.md is complete: every M3 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M3's scope changed. Or stop after 60 turns and list what is left.
```

- [x] Migration `collection` (6.3). Test: `tests/db/collection.test.ts`: retention capped at 7 days for `reddit` and `x` and 30 for the rest; `ingest_post` refuses suppressed authors, never extends retention and returns the existing id on conflict; two concurrent `claim_jobs` calls never take the same job; `consume_budget` refuses the call that would cross the limit and `settle_budget` returns unused units; `purge_expired` deletes expired and orphaned posts and clears example ids; writing an author handle fails (planted); `authenticated` cannot select `author_hash` or `author_handle`; every function is refused to anon and authenticated. Also, after review: job budgets reserved and settled once per job (the monthly cap counted over the month of the day charged, under one lock per source), term stats recorded once per job, term rotation, the Reddit re-check lists, `delete_posts_at_source`; an abandoned lease is a failure and the third fails the job; the purge and deletion sync are claimed first; `finish_job` takes an error class only (planted message refused) and finishes only a running job; retention is never extended and an expired post is never linked again; Reddit profile posts are refused in every form (planted); a null count never zeroes the ledger; no function in `public` is executable by anon or authenticated (catalog test).
- [ ] (you) Apply `collection` to the development project once F12 creates it (advisors clean), then to production after you say yes. Nothing in it deletes data. Then regenerate `src/types/database.ts` and rename the file to the version Supabase records.
- [x] Source contract v2 (7.1). Test: registry tests for `access`, `vendor`, `retentionDays`, `linkHosts` (every link host refused by `safeFetch`), kill switches off by default. Also: each source gets its own `ctx.fetch` (`createSourceFetch`, safeFetch bound to its own `allowedHosts`, the kill switch read on every request; another source's host is refused); `registryProblems()` checks every rule with a planted source each (only `reddit` may be `vendor_api`, retention by source, no platform web host, proxy or mirror in `allowedHosts`, link hosts never fetchable, credentials named for the source or its vendor); a vendor source stays off on any deployment until its DPA date is set and the module states the vendor's snapshot retention (2.1.7, 2.3.12).
- [x] Author hashing (12.5). Test: `@Name`, `name` and `u/name` hash the same within a source and differently across sources; a missing pepper throws; no raw author key reaches a store, log or error (spy test). Also: a short or `.env.example` placeholder pepper is refused.
- [ ] Jobs runner and cron routes `/api/cron/daily`, `/api/cron/tick`, `/api/cron/weekly` (7.2, 13). Test (fake clock, fake sources): a pending vendor run resumes on a later tick; a crash mid-step re-runs without double-charging a budget or double-inserting a post; the time budget stops new claims; three failures mark a job `failed`; daily enqueue is idempotent; `tests/deploy/vercel-config.test.ts` covers the new routes.
- [ ] Hacker News source (7.4). Test: synthetic fixtures in `tests/fixtures/hackernews/` (invented authors and text); stops at the budget; link back on `news.ycombinator.com`; HTML stripped; 280 characters; deleted and dead items found by `checkDeleted`.
- [ ] Bluesky source (7.5). First confirm hosts and auth against docs.bsky.app and record the date and hosts in the module header. Test: synthetic fixtures; adult self-labels dropped as NSFW; one session per invocation; links use the DID; `checkDeleted` via `getPosts`; the module references no write method (no `com.atproto.repo` calls).
- [ ] Reddit source through Bright Data (7.7). First confirm the dataset, parameters, fields and price against Bright Data's docs and record the date in the module header. Test: fixtures for trigger, progress (running, then ready) and snapshot; error records, NSFW, deleted authors, profile posts (`u_` communities, `/user/` and `/u/` URLs), sensitive communities and non-Reddit URLs dropped; budget and monthly cap stop calls; cost recorded; 5 MB cap; `safeFetch` refuses every Reddit host; a request with an unpinned dataset id (planted: a LinkedIn dataset id) is refused before it is sent, including when it comes from the env; the source's `ctx.fetch` refuses every other source's host; a request to any other path on the vendor host (planted: a general unlocking or search API path) is refused; only `reddit` may declare `access: "vendor_api"` (registry test with a planted violation); the vendor host appears in no file outside `src/sources/reddit*.ts` (static check with a planted violation); if the docs confirm the features, the trigger requests only the mapped fields and the snapshot is deleted after download; every committed fixture's author fields match the invented pattern. `isPlatformHost()` refuses the vendor host, imported from the Reddit module (12.3).
- [ ] (you) F8, then run `scripts/capture-brightdata-fixture.ts` once on your machine: it checks a real response against the schema locally, prints pass or fail and the field names, and deletes the capture. Real responses never enter the build session.
- [ ] Minimal privacy-notice section and sources-page entry naming Bright Data, what it collects (public Reddit pages, logged out), that this is not a data license from Reddit, and its snapshot retention. Test: both pages render it; in production the Reddit source refuses to start until `BRIGHTDATA_DPA_SIGNED_ON` holds a date (the founder sets it after F8's DPA, transfer mechanism and DPIA steps), and `/api/health`'s `sources` check reports the same.
- [ ] (you) Review `src/sources/sensitive-communities.ts` before Reddit is switched on.
- [ ] X source (7.6), shipped off. Test: synthetic fixtures; a budget of 0 makes no call; the source refuses to start until deletion compliance is implemented; `possibly_sensitive` posts dropped; links on `x.com`.
- [ ] Collect step end to end (7.3) with fake sources and a fake classifier. Test: suppressed authors never stored from any source; posts already linked are skipped; posts stored for another product are classified for this one; `term_stats` updated; only entitled, confirmed, unpaused products of accounts on `SIGNUP_ALLOWLIST` are collected (12.10, until the launch switch).
- [ ] Purge (every tick on Pro, daily before), reads that exclude rows past `delete_after`, deletion sync, and the Reddit deletion re-check (7.7) running before new collection with its reserved share of the monthly cap. Test: expired posts gone the next day; Hacker News and Bluesky posts deleted at source removed here; a stored Reddit post the vendor reports gone or removed at about 72 hours is deleted, within the budget, and `REDDIT_DELETION_RECHECK=false` turns it off.
- [ ] Kill switches and caps. Test: `SOURCE_<ID>_ENABLED=false` stops that source within one run; the monthly vendor cap stops Reddit and shows in the job result.
- [ ] Reddit term rotation (7.3 step 2). Test: over three days every active term is collected at least once with 12 terms a day.
- [ ] `/api/health` gains a `sources` check: enabled collect sources and any missing credentials, no secrets. Test: unit tests.
- [ ] Switch to the Pro schedule (13) only after F2: trial reminders hourly with `REMINDER_CRON_PERIOD_HOURS = 1`, `/api/cron/tick` every 10 minutes, `tests/deploy/vercel-config.test.ts` updated in the same commit. Confirm Pro with the founder or `get_auth_user` (`billing.plan` is `pro`). Until then leave this box open.
- [ ] (you) F2 Vercel Pro and F7 Bluesky account, then turn Hacker News and Bluesky on in Vercel. Turn Reddit on only when `docs/PLAN.md` 2.1.7 holds: DPA signed, transfer mechanism recorded, DPIA covering the vendor signed, Bright Data named in the privacy notice and on the sources page.

## M4 Classifier

```
/goal Milestone M4 in docs/TASKS.md is complete: every M4 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M4's scope changed. Or stop after 40 turns and list what is left.
```

- [ ] Migration `classification` (6.4). Test: `tests/db/classification.test.ts`: highlight range constraint; the user can still update only `state` on `product_posts`; `compliance:schema` passes.
- [ ] Classification schema and the sensitive-trait guard (8.2). Test: no property name matches the banned list; every system prompt contains the never-infer rule; the schema validates the fixtures.
- [ ] Haiku classification in batches of 20 with post-processing (8.2). Test (fake model): unknown ids dropped; relevance below 40 and `not_relevant` discarded; highlight offsets from exact matches only; `tool_mentioned` with `@`, `u/`, an email or a URL rejected; unknown `competitor_key` dropped; a refusal skips the batch and is counted.
- [ ] Prompt caching. Test: the cached block exceeds the model's documented minimum; a recorded pair of API responses shows `cache_read_input_tokens` above zero on the second call.
- [ ] Dedupe. Test: the same post found by two terms, two sources' URLs or two products yields one `posts` row and one `product_posts` row per product.
- [ ] Spend caps (8.1). Test: the per-product monthly cap and the global daily cap each stop classification and show in the job result.
- [ ] Eval script `npm run eval:classifier` (8.6). Test: runs against a 5-row sample file with a fake model and prints precision and recall.
- [ ] (you) F16: label 100 posts; precision is at least 0.8 at the default threshold; then replace section 18's model estimates with measured numbers from `llm_usage`.

## M5 Reply tab

```
/goal Milestone M5 in docs/TASKS.md is complete: every M5 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M5's scope changed. Or stop after 40 turns and list what is left.
```

- [ ] Feed queries for Today, All, Saved and Replied with filters in the URL (4.4). Test: PGlite with 200 seeded rows: the right rows for each view and filter; another user's rows never returned.
- [ ] `PostCard` and `FilterBar`. Test: render shows source and community, age, category, match, excerpt with highlight, the reason, an Open post link with `rel="noopener noreferrer"`, the reply tip and "Say you built it.".
- [ ] Save, Mark replied, Hide and Undo as server actions. Test: Mark replied removes the post from Today; only `state` changes.
- [ ] Reply tips are fixed copy (D8). Test: the list of modules that call the model is exactly draft, classify, synthesize and preview, and none of their prompts asks for reply text.
- [ ] Search links panel, including subreddit links (7.8). Test: every link is https on a declared link host, with the term encoded; the panel shows "Say you built it.".
- [ ] Keyboard shortcuts (`j`, `k`, `o`, `s`, `r`, `h`, `?`). Test: E2E.
- [ ] Performance. Test: E2E on localhost with 200 seeded cards renders in under 1.5 seconds.
- [ ] First run after checkout (7.3) with progress by source and the "feed ready" email. Test (fakes): `first_run` is enqueued once, results appear as sources finish, the email is sent once.
- [ ] Daily posts email (11) with one-click unsubscribe. Test: tokens verify and expire with the secret; `POST /api/unsubscribe` turns it off and `GET` does not; no email when there are no new posts; the email contains no post excerpts and shows "Say you built it."; sends at 08:00 UK time across the daylight saving change.
- [ ] Loading, empty and error states (4.9). Test: render tests.
- [ ] (you) F10 and F6: trademark search and the domain, then the Resend domain and `EMAIL_FROM`; then one real daily email checked by you.

## M6 Rivals tab

```
/goal Milestone M6 in docs/TASKS.md is complete: every M6 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M6's scope changed. Or stop after 40 turns and list what is left.
```

- [ ] Migration `rivals` (6.5) and `purge_expired` clearing its example ids. Test: `tests/db/rivals.test.ts`: owner reads, another user cannot, API roles cannot write, the uniqueness rule holds for tracked and discovered rivals.
- [ ] Rival queries: complaints per rival and issue for this week and the last 8, switching posts, discovered tools. Test: PGlite fixtures with known counts.
- [ ] Rivals UI (4.5): picker, this-week scorecards, issue breakdown with sparklines, people looking to switch, what you could fix, discovered tools. Test: render tests and one E2E; "Say you built it." wherever the tab links to posts.
- [ ] Weekly rival synthesis (8.4). Test (fake model): counts come from labels, not the model; trends computed against last week; a summary copying 8 or more words of an excerpt is regenerated once and then dropped; handles rejected.
- [ ] Track a discovered tool. Test: it becomes a competitor and "<tool> alternative" is offered as a term.
- [ ] Markdown export of the week's rival report. Test: contains no handles and no excerpt quotes.

## M7 Build tab

```
/goal Milestone M7 in docs/TASKS.md is complete: every M7 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M7's scope changed. Or stop after 40 turns and list what is left.
```

- [ ] Migration `build_themes` (6.6). Test: `kind` and `theme_key` constraints.
- [ ] Weekly Build synthesis (8.4). Test (fake model): themes regenerate weekly; trend uses last week's counts by `theme_key`; at most 3 example ids; the quote check and handle check apply.
- [ ] Build UI (4.6): themes, wished it existed, what to build next, week picker. Test: render tests; no author names or handles in the rendered output with fixture data; "Say you built it." wherever the tab links to posts.
- [ ] Markdown export. Test: matches the screen minus excerpts (links only) and contains no quotes or handles.
- [ ] Monday digest (11) with Build and Rivals highlights and a working unsubscribe. Test: unsubscribe works; "Say you built it." wherever it links to posts; no post excerpts; sends Monday 08:00 UK time across the daylight saving change.

## M8 Billing

```
/goal Milestone M8 in docs/TASKS.md is complete: every M8 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M8's scope changed. Or stop after 40 turns and list what is left.
```

- [x] Checkout Session builder: 7-day trial, card required, trial cancels if no card is left, renewal terms on the payment page, Managed Payments on. Test: `src/server/billing/checkout.test.ts`.
- [x] Webhook: signature verified on the raw body, bounded body size, idempotent, ordering-safe (subscription state is re-fetched, stale patches dropped). Test: `events.test.ts`, `handlers.test.ts`, `tests/db/billing-functions.test.ts`; verified against a running production server with a correctly signed, a forged and a tampered request.
- [x] No second subscription while one is live (including past_due). Test: `handlers.test.ts`.
- [x] Cancel and resume handler for the two-click flow, plus billing portal link. Test: `handlers.test.ts`.
- [x] Trial reminder at least 48 hours before the first charge even if one run fails, on the daily (Hobby, 73 to 98 hours ahead) and the hourly (Pro, 50 to 52 hours) schedule. Test: `trial-reminders.test.ts` simulates whole trials on both cadences and on the deployed default, the daily one with Hobby's in-hour jitter across 72 start times, with and without a failed first run: exactly one reminder, never less than 48 hours ahead, none after a cancel, re-armed if the trial is extended, a hung send released, a spent time budget deferring the rest; a plain 48-hour window is shown to fail. Live billing refuses to start unless the reminder runs hourly (`config.test.ts`).
- [x] Live mode locked: a live key needs `BILLING_LIVE_ENABLED=true` and Managed Payments on. Test: `config.test.ts`.
- [x] Checkout also requires `terms_accepted_at` and a confirmed product before it creates a session (today a signed-in, allowlisted user could call it without the 18+ confirmation). Test: `handlers.test.ts`. Also: the rule is `isConfirmedProduct()`, shared with `/app` routing (named statuses only: `active`, `paused`); terms and product are read through the user's own client, so RLS backs the owner filter; cancel and the portal never read them, so nothing can block a cancellation.
- [ ] Migration `billing_consent` (6.7). Test: only the service role can write `service_consent_at`.
- [ ] `/app/billing` (10.1): the full price with tax included where it applies, renewal terms, first charge date, the reminder, how to cancel, the consent checkbox, before checkout. Test: render shows each item; the checkout handler answers 400 without `{ consent: true }`.
- [ ] Consent record (10.2). Test: the consent time travels in subscription metadata and the webhook writes `service_consent_at`.
- [ ] Settings, Plan and billing (10.3): status in plain words, two-click cancel, resume, update card, `past_due` banner. Test: E2E in test mode on localhost.
- [ ] Welcome step after checkout (7.3): retrieves the Checkout Session from `session_id`, checks `client_reference_id`, applies the billing patch before any gate. Test: a just-paid user whose webhook has not arrived yet lands on Reply, not billing, and a second checkout is refused.
- [ ] Entitlement checked on every app data page and before any collection (10.4). Test: a non-entitled user sees the billing page and no collection job runs for them.
- [ ] The trial reminder states the full amount to be charged, tax included where it applies (10.5). Test: with a tax-exclusive price, the email uses Stripe's invoice preview total.
- [ ] Account deletion and export (10.5, 10.6). Test: E2E in test mode: the subscription is canceled at once, the auth user and every owned row are gone, `events` and `audit_log` record it; the export contains the user's data and nothing of anyone else's, and no post excerpts.
- [ ] Public pricing page with rows in `docs/claims.md`. Test: `compliance:copy` passes; every number on the page is a claim row; the price shown is the full price with tax included where it applies.
- [ ] Checkout E2E in test mode without driving Stripe's page (10.8). Test: the redirect goes to Stripe Checkout with the right parameters; completing the subscription with the test API and posting a signed event to the local webhook makes the account entitled.
- [ ] (you) F11: Stripe set up in test mode; `/api/health` shows `stripe_config`, `stripe_price` and `stripe_webhook` ok.
- [ ] (you) The consent wording reviewed by a solicitor.
- [ ] (you) F14: click through test mode yourself, then switch to live with the checklist in `docs/BILLING.md`.

## M9 Launch surface

```
/goal Milestone M9 in docs/TASKS.md is complete: every M9 box not marked (you) is ticked, `npm run check` exits 0, CI is green on the pushed branch, the compliance-reviewer and code-reviewer subagents report no blocking findings, and no file outside M9's scope changed. Or stop after 40 turns and list what is left.
```

- [ ] Migration `launch` (6.8). Test: `preview_runs` expiry check; both tables deny-all for API roles.
- [ ] Landing page (9.6) with labeled example data and rows in `docs/claims.md`. Test: `compliance:copy` passes; every claim on the page has a row; example cards contain no handles.
- [ ] Instant preview (8.5, 12.7). Test: 3 per IP hash per day and the global cap enforced; no Reddit or X call is possible from the preview; a platform URL is refused; suppressed authors are dropped; the stored result validates against a schema with no author fields; only relevance 40 or more is shown or stored; results expire within 24 hours and the purge removes them.
- [ ] Sources page. Test: lists exactly the registry, with access method, retention and the vendor for vendor sources.
- [ ] `/bot` page (12.3): what the site reader fetches and why, its robots token `AskedFor`, and a monitored contact email; the User-Agent links to it. Test: renders the token and the contact; `compliance:copy` passes.
- [ ] Remove-my-post form and admin queue (4.8). Test: rate limit; one admin click deletes matching posts, suppresses the author hash, closes the request, emails the requester and writes `audit_log`; the author is never stored again; a request by post link suppresses that post's author; a request by Bluesky handle resolves to the DID and suppresses the DID-keyed author; an X username resolves to the user id.
- [ ] Admin pages: source health, costs, metrics (4.8). Test: a non-admin gets 404; metrics contain no post text or emails.
- [ ] Legal drafts and `docs/legal/` (12.9). Note in the privacy notice and ROPA that Google sign-in makes Supabase keep the Google account name and picture URL in its auth tables (the app never reads them), and list the Supabase cookies on the cookies page (the session cookie, split into numbered chunks when large, and the PKCE verifier). Test: every page footer links them; the privacy notice names every processor in `src/server/net/hosts.ts`, every collect source in the registry and every vendor `name` (test compares the lists), and states the vendor's snapshot retention.
- [ ] Security headers (12.8). Test: present on `/` and `/app`.
- [ ] (you) Read every claim on the landing, pricing and sources pages against `docs/claims.md` before they merge to production.
- [ ] Launch switch: remove the `noindex` metadata, the robots disallow and the `SIGNUP_ALLOWLIST` check (sign-in, app pages, checkout, collection), only when the founder says launch. Test: the three change together. Add a per-IP-hash limit on magic-link requests first (ask the founder). (you) Then turn Supabase "Allow new users to sign up" back on.
- [ ] (you) F15 legal, and the pre-launch checklist in `docs/BRIEF.md` with route C applied.

# AskedFor

Who to reply to today. What your rivals get wrong. What to build next. Indie makers get a daily list of public posts worth replying to (Reply tab), what their competitors get wrong (Rivals tab) and the patterns in what people ask for (Build tab). FYB is the internal codename.

The plan, source of truth: `docs/PLAN.md`. Read it in full at the start of a session and re-read the sections for your task after any context reset. Decisions D1 to D12 in it are approved once the founder hands the plan to a build session (see its status line); do not reopen them. Sections 1 and 2 of the plan change only with the founder's approval (`tests/docs/prd.test.ts` pins them).
Tasks: `docs/TASKS.md` (tick boxes as you finish)
Claims register: `docs/claims.md`
Billing setup and the live checklist: `docs/BILLING.md`
History, superseded wherever the plan disagrees: `docs/BRIEF.md` (never reformat or edit it), `docs/PRD.md`, `docs/PHASE0-FINDINGS.md`

## Commands

- `npm run dev`: local app
- `npm run check`: typecheck, lint, format check, all tests including compliance gates and database tests. Must exit 0 before any task is done.
- `npm run compliance`: just the four CI gates (`compliance:hosts`, `:deps`, `:schema`, `:copy`)
- `npm test`: Vitest. Database tests run real Postgres in-process (PGlite), about 10 seconds.
- `npm run format`: Prettier
- `npm run build`: production build; needs no secrets
- `npm run db:migrate`, `npm run db:types`: Supabase CLI (needs `supabase login` and a linked project); the Supabase connector's `apply_migration` and `generate_typescript_types` do the same
- `npm run test:e2e`: arrives with M1 (Playwright, localhost only). `npm run eval:classifier`: arrives with M4 (manual, live API)

## Stack

Next.js 16 App Router (`src/proxy.ts`, which Next 16 uses instead of middleware; Next 16 differs from older versions, so read the version-matched guides in `node_modules/next/dist/docs/` before using an API), TypeScript strict, Tailwind 4, Supabase (project `askedfor`, London `eu-west-2`, ref `hoqbflkszzoojdswbrgy`, RLS on every table), Vercel (functions in `lhr1`), Vercel Cron plus a jobs table, Anthropic API, Resend, Stripe with Managed Payments as merchant of record.

## Non-negotiables

The full list is `docs/PLAN.md` section 2. The short version:

- All outbound HTTP to sources goes through `safeFetch()` in `src/server/net/`. Only hosts in `src/sources/registry.ts` are allowed, plus `fetchOwnSite()` (`src/server/net/own-site.ts`, M2) for the user's own URL. Processor hosts are in `src/server/net/hosts.ts` and are reached only through their official SDKs.
- Route C (D1): Reddit only through the contracted data vendor's REST API (Bright Data) called with `safeFetch()`. Never fetch reddit.com yourself, never log in to a platform, never run a browser against a third-party site. X only through the official API, off by default, with a daily budget. Hacker News and Bluesky through their official APIs. LinkedIn, Facebook, Instagram, TikTok, Threads, YouTube and Discord are never collected; Product Hunt is never accessed.
- The vendor is for Reddit only: each source's `ctx.fetch` is bound to its own hosts, and the Reddit module calls only pinned vendor paths and Reddit dataset ids. `fetchOwnSite()` and the instant preview refuse every platform host.
- No scraping SDKs, vendor SDKs, headless browsers or stealth tools. A hook and CI block them. Playwright is a dev dependency for localhost E2E only.
- Never build anything that posts, replies, votes, follows or messages on any platform.
- No model ever writes reply text. Reply tips are fixed copy; the user writes every word.
- Store the minimum: excerpt max 280 chars, a keyed hash of the author and no handle, no avatars, bios, follower counts or emails on post tables. Only posts rated relevant are stored. Retention is 7 days for Reddit and X and 30 days for the rest. Every write path respects `delete_after` and the suppression list.
- Raw vendor and API payloads are never stored and never logged. Committed test fixtures are synthetic: invented authors and text, never a real person's post. Live captures go to the git-ignored `fixtures-local/`.
- Drop Reddit posts from sensitive communities (health, sexuality, religion, politics, ethnicity and similar) and from user profiles before classification and storage.
- Emails and exports carry links and our own labels, never post excerpts.
- Rivals and Build never show author names or handles, and their summaries never quote posts.
- Never infer or store sensitive traits about anyone.
- Never write fake testimonials, reviews, user counts, badges, logos or "as seen on". Every public claim and every number needs an entry in `docs/claims.md`. Never claim "we don't scrape" or "official APIs only"; say plainly where posts come from.
- Platform names in text only; no third-party logos in `public/`.
- No em dashes in UI copy, emails or docs. US English.
- Show the full price up front, tax included where it applies (no drip pricing).
- Billing stays in Stripe test mode until the founder unlocks live (`docs/BILLING.md`). Never use or request live keys.
- Cron schedules stay daily-only until the founder confirms Vercel Pro (D6, `tests/deploy/vercel-config.test.ts`).

## Conventions

- Validate all external input with zod at the boundary, including vendor and API responses.
- The Supabase service-role (secret) key lives only in `src/server/`; never import it in client code. Server files that touch secrets start with `import "server-only"`.
- All model calls go through `src/server/llm/` with JSON schema outputs, zod validation, spend caps and logged token usage.
- Each source is a module in `src/sources/` following `.claude/rules/data-sources.md`.
- Kill switch per source (`SOURCE_<ID>_ENABLED`); collect sources default off, link sources default on.
- Business logic depends on ports with fakes in tests (`src/server/billing/ports.ts` is the pattern). Inject the clock.
- Route handlers are thin: build deps, call a factory such as `createCheckoutHandler(deps)`, return its response.
- Database changes are migrations in `supabase/migrations/`, named with the version Supabase recorded. Write the test in `tests/db/` first, apply it to the development project and run the Supabase advisors there, then ask the founder before applying it to production (`docs/PLAN.md` section 0, item 7), then regenerate `src/types/database.ts`. The session holds development keys only, never the production secret key.
- Log error class names only. Never log bodies, emails, post text, author ids or Stripe payloads.
- Missing secrets never block building: finish the code and tests with fakes, and leave the live check in a `(you)` box.

## The loop

Tests, hooks and CI decide what "done" means, not your opinion of your own work.

1. Read the task's acceptance test in `docs/TASKS.md` and the plan section it points to.
2. Write the test first and watch it fail. Then the smallest change that passes.
3. Run `npm run check`.
4. Ask the `code-reviewer` and `compliance-reviewer` subagents to find problems, not to approve.
5. Fix every blocking finding and run the checks again.
6. Tick the box, commit, take the next task.

When you add a rule or gate, also add a test that plants a violation and expects it caught.

## Definition of done (every task)

1. The acceptance test from `docs/TASKS.md` is written first and passes.
2. `npm run check` exits 0.
3. compliance-reviewer subagent: no blocking findings.
4. Box ticked in `docs/TASKS.md`, one focused commit. A milestone is done when CI is green on the pushed branch.

## Ask before you

- Change data sources, stored fields, retention, billing, pricing or any public claim beyond what `docs/PLAN.md` specifies.
- Add a processor, a cookie, analytics, a runtime dependency or an outbound host that `docs/PLAN.md` does not list (sections 5.3, 7, 12.4 and 14).
- Run a production migration (show the SQL and its passing test; call out anything destructive).
- Edit `docs/PLAN.md` sections 1 or 2 (decisions and hard rules).
- Delete production data outside the retention and removal jobs, touch live keys, or switch billing to live.
- Create a Supabase project, a Stripe object in live mode, or anything else that costs money.

## Where things are

- `src/sources/`: source contract, registry (the allowlist), link-mode sources; collect sources arrive in M3
- `src/server/net/`: `safeFetch`, host lists; `own-site.ts` arrives in M2
- `src/server/billing/`: Stripe checkout, webhook events, cancel, trial reminders (ports, handlers, adapters)
- `src/server/health/`: `/api/health` checks (Supabase, Stripe price and webhook endpoint, email)
- `src/server/supabase/`: admin and server clients
- `src/app/(marketing)/`: public pages, copy rules apply. `src/app/api/`: thin route handlers
- `emails/`: email templates, copy rules apply
- `compliance/`: denylist and scanners behind the CI gates. `tests/compliance/` applies them to the repo
- `supabase/migrations/`: schema, RLS, grants, functions. `tests/db/`: migration and RLS tests
- `tests/deploy/`: `vercel.json` and Node version guard
- `scripts/hooks/`: Claude Code hooks. `.claude/agents/`, `.claude/rules/`: reviewers and path-scoped rules

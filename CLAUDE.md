# AskedFor

Who to reply to today. What to build next. Indie makers get a daily list of public posts worth replying to (Reply tab) and the patterns in what people ask for (Build tab), from allowed sources only. FYB is the internal codename.

Scope: @docs/PRD.md
Full brief, read when a task needs it: `docs/BRIEF.md` (source of truth, never reformat or edit it mid-chat)
Tasks: `docs/TASKS.md` (tick boxes as you finish)
Claims register: `docs/claims.md`
Open questions and gaps: `docs/PHASE0-FINDINGS.md`
Billing setup and the live checklist: `docs/BILLING.md`

## Commands

- `npm run dev`: local app
- `npm run check`: typecheck, lint, format check, all tests including compliance gates and database tests. Must exit 0 before any task is done.
- `npm run compliance`: just the four CI gates (`compliance:hosts`, `:deps`, `:schema`, `:copy`)
- `npm test`: Vitest. Database tests run real Postgres in-process (PGlite), about 10 seconds.
- `npm run format`: Prettier
- `npm run db:migrate`, `npm run db:types`: Supabase CLI (needs `supabase login` and a linked project)
- `npm run test:e2e`: arrives with M1 (Playwright, localhost only)

## Stack

Next.js App Router, TypeScript strict, Tailwind 4, Supabase (project `askedfor`, London `eu-west-2`, ref `hoqbflkszzoojdswbrgy`, RLS on every table), Vercel Cron, Anthropic API, Resend, Stripe with Managed Payments as merchant of record.

## Non-negotiables

- All outbound HTTP goes through `safeFetch()` in `src/server/net/`. Only hosts in `src/sources/registry.ts` are allowed, plus `fetchOwnSite()` (M1) for the user's own URL during onboarding. Processor hosts are listed in `src/server/net/hosts.ts` and are reached only through their official SDKs.
- Never add scraping tools or services: no Puppeteer or Playwright against third-party sites; no Apify, Bright Data, SerpApi, Oxylabs or similar SDKs. A hook and CI block this. Playwright is allowed as a dev dependency for localhost E2E only.
- Never build anything that posts, replies, votes, follows or messages on any platform.
- Never generate replies for users. Reply tips are fine; the user writes the words.
- Store the minimum: excerpt max 280 chars; no avatars, bios, follower counts or emails on post tables. Every write path respects `delete_after` (30 days) and the suppression list.
- The Build tab never shows author names or handles.
- Never infer or store sensitive traits about anyone.
- Never write fake testimonials, reviews, user counts, badges, logos or "as seen on". Every public claim and every number needs an entry in `docs/claims.md`.
- Platform names in text only; no third-party logos in `public/`.
- No em dashes in UI copy or emails. US English.
- Billing stays in Stripe test mode until the founder unlocks live (`docs/BILLING.md`). Never use or request live keys.

## Conventions

- Validate all external input with zod at the boundary.
- The Supabase service-role (secret) key lives only in `src/server/`; never import it in client code. Server files that touch secrets start with `import "server-only"`.
- All model calls go through `src/server/llm/` (M1) with JSON schema outputs and logged token usage.
- Each source is a module in `src/sources/` following `.claude/rules/data-sources.md`.
- Feature flag per source (`SOURCE_<ID>_ENABLED`); X is off by default.
- Business logic depends on ports with fakes in tests (`src/server/billing/ports.ts`). Inject the clock.
- Route handlers are thin: build deps, call a factory such as `createCheckoutHandler(deps)`, return its response.
- Database changes are migrations in `supabase/migrations/`, named with the version Supabase recorded. Write the test in `tests/db/` first, then apply, then run the Supabase advisors and fix what they report.
- Log error class names only. Never log bodies, emails, post text or Stripe payloads.

## The loop

Tests, hooks and CI decide what "done" means, not your opinion of your own work.

1. Read the task's acceptance test in `docs/TASKS.md`.
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
4. Box ticked in `docs/TASKS.md`, one focused commit.

## Ask before you

- Change data sources, stored fields, retention, billing, pricing or any public claim.
- Delete data, run production migrations, or touch live keys.
- Add a processor, a cookie, analytics or any new outbound host.
- Create a Supabase project, a Stripe object in live mode, or anything that costs money.

## Where things are

- `src/sources/`: source contract, registry (the allowlist), link-mode sources
- `src/server/net/`: `safeFetch`, host lists
- `src/server/billing/`: Stripe checkout, webhook events, cancel, trial reminders (ports, handlers, adapters)
- `src/server/supabase/`: admin and server clients
- `src/app/(marketing)/`: public pages, copy rules apply. `src/app/api/`: thin route handlers
- `emails/`: email templates, copy rules apply
- `compliance/`: denylist and scanners behind the CI gates. `tests/compliance/` applies them to the repo
- `supabase/migrations/`: schema, RLS, grants, billing functions. `tests/db/`: migration and RLS tests
- `scripts/hooks/`: Claude Code hooks. `.claude/agents/`, `.claude/rules/`: reviewers and path-scoped rules

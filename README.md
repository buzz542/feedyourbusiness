# AskedFor

Who to reply to today. What your rivals get wrong. What to build next. (Internal codename: FYB.)

AskedFor shows indie makers which public posts are worth replying to, what their competitors get wrong, and
what to build next. Start with `docs/PLAN.md` (the plan and the rules in force), then `docs/TASKS.md`.
`docs/BRIEF.md`, `docs/PRD.md` and `docs/PHASE0-FINDINGS.md` are history.

## Run it

```
nvm use            # Node 22 (22.12 or newer)
npm ci
cp .env.example .env.local   # fill in the values
npm run dev
```

`npm run check` is the definition of done: typecheck, lint, format, and every test, including the compliance
gates and the database tests (real Postgres in-process, no Docker).

After a deploy, `GET /api/health` with `Authorization: Bearer $CRON_SECRET` checks Supabase, Stripe and email
(`docs/PLAN.md`, section 16).

## Layout

See the "Where things are" section in `CLAUDE.md`. Billing setup is in `docs/BILLING.md`.

## Rules that never bend

Where posts come from is stated plainly: Hacker News and Bluesky through their official APIs, Reddit through a
web data company that collects public Reddit pages for us (not a data license from Reddit), X through its
official API when it is switched on. Never posting or replying for users, no AI-written replies, no fake
testimonials, minimum data stored, no author handles, raw posts deleted after 7 days (Reddit, X) or 30 days
(the rest). They are enforced by CI gates and Claude Code hooks, not by good intentions. See `docs/PLAN.md`,
section 2.

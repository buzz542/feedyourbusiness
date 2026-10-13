# AskedFor

Who to reply to today. What to build next. (Internal codename: FYB.)

AskedFor shows indie makers which public posts are worth replying to and what to build next, using only
sources it is allowed to use. Start with `docs/BRIEF.md` (the source of truth), then `docs/PRD.md`,
`docs/TASKS.md` and `docs/PHASE0-FINDINGS.md`.

## Run it

```
nvm use            # Node 22
npm ci
cp .env.example .env.local   # fill in the values
npm run dev
```

`npm run check` is the definition of done: typecheck, lint, format, and every test, including the compliance
gates and the database tests (real Postgres in-process, no Docker).

## Layout

See the "Where things are" section in `CLAUDE.md`. Billing setup is in `docs/BILLING.md`.

## Rules that never bend

No scraping, no posting for users, no fake testimonials, minimum data stored, raw posts deleted after 30 days.
They are enforced by CI gates and Claude Code hooks, not by good intentions. See "Hard compliance rules" in
`docs/PRD.md`.

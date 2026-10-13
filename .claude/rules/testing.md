# Testing

Always loaded.

- Write the acceptance test from `docs/TASKS.md` first, watch it fail, then make the smallest change
  that passes. Tests decide "done", not opinion.
- Record fixtures. CI never calls a live third-party API. E2E runs against localhost only.
- Database behavior is tested against real Postgres (PGlite) in `tests/db/`, with Supabase's roles and
  `auth.uid()`. Migrations run exactly as in production. Test the negative cases: another user's rows,
  columns a user must not write, retention caps.
- A gate or scanner that has never been seen to fail is not a gate. When you add a rule, add a test that
  plants a violation and expects it to be caught (see `compliance/lib/scanners.test.ts`).
- Inject the clock. Reminder, retention and trial logic take `now` as a parameter so tests can travel
  through time.
- Business logic depends on small ports (`src/server/billing/ports.ts`), with fakes in tests. Adapters
  that wrap the Stripe SDK or Supabase stay thin.
- Billing is test mode only until the founder switches live on (`docs/BILLING.md`).

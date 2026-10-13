---
paths:
  - "src/sources/**"
  - "src/server/net/**"
---

# Data sources

Source of truth: `docs/BRIEF.md`, "Data sources" and "Hard compliance rules". Do not change a source,
its host list or its access method without founder approval.

## Module contract

Each source is `src/sources/<id>.ts` and exports one `Source` (see `src/sources/types.ts`):
`id`, `mode` (`collect` or `link`), `termsUrl`, `allowedHosts`, `dailyBudget`, plus `collect()` in collect
mode or `searchLinks()` in link mode. Register it in `src/sources/registry.ts`. That file is the only
allowlist.

## Rules

- Collect sources get `ctx.fetch`, which is `safeFetch()`. They never import `fetch`, an HTTP client or
  an SDK that opens its own connections. `npm run compliance:hosts` fails if they do.
- Link sources never fetch anything. They build a search URL that the user opens in their own browser.
- Reddit, LinkedIn, Facebook, Instagram, TikTok, Threads, YouTube and Discord are link-only, forever.
  Product Hunt is not accessed. X is phase 2: official API, pay-per-use, hard daily read budget per
  customer, honor deletions, no model training, off by default.
- Every source has a kill switch, `SOURCE_<ID>_ENABLED`. Collect sources default off, link sources on.
- Respect `dailyBudget`: write to `usage_ledger` and stop at the limit. Dedupe within the UTC day.
- Politeness: low request rates, a descriptive User-Agent with a monitored contact, back off on 429.
- Always store a link back to the original item. Excerpts are at most 280 characters.
- Honor deletions: a post deleted at the source is deleted here (deletion sync).
- Fixtures only in tests. CI never calls a live third-party API.
- Before the first collect source ships, confirm its hosts, auth rules and terms against the current
  official docs and record the date in the module header. Terms change; re-read them in launch week.

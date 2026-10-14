---
paths:
  - "src/sources/**"
  - "src/server/net/**"
  - "src/server/pipeline/**"
---

# Data sources

Source of truth: `docs/PLAN.md`, decision D1, section 2.1 and section 7. Do not change a source, its host
list or its access method beyond what the plan specifies without founder approval.

## Module contract

Each source is `src/sources/<id>.ts` and exports one `Source` (see `src/sources/types.ts`). Collect sources
declare `id`, `mode: "collect"`, `access` (`official_api` or `vendor_api`), `vendor` (name and DPA link, for
vendor sources), `termsUrl`, `allowedHosts`, `linkHosts`, `dailyBudget`, `retentionDays`, `costPerUnitUsd`,
and implement `start()`, plus `poll()` for asynchronous vendor runs and `checkDeleted()` where the source
allows it. Link sources declare `linkHosts` and implement `searchLinks()`. Register every source in
`src/sources/registry.ts`, the only allowlist.

## Rules

- Collect sources get `ctx.fetch`, which is `safeFetch()`. They never import `fetch`, an HTTP client or an
  SDK that opens its own connections. `npm run compliance:hosts` fails if they do.
- `allowedHosts` holds API hosts only, never a platform's own site: a Reddit source lists the vendor's API
  host, never `reddit.com` or `redd.it`. Hosts that appear in stored links go in `linkHosts` and are never
  fetched (safeFetch refuses them).
- Reddit: only through the contracted vendor's REST API (Bright Data by default, behind the
  `RedditProvider` port). Logged-out public posts only; drop NSFW, over-18, private and quarantined content.
  No Reddit login, account, cookie or browser, ever.
- X: only the official API v2, with a per-product daily read budget (`X_DAILY_READS_PER_PRODUCT`, default 0),
  deletion compliance implemented before it can start, and no model training. Off by default.
- Hacker News: Algolia HN Search and the Firebase item API. Bluesky: authenticated XRPC from the dedicated
  AskedFor account, read-only, following the Bluesky Developer Guidelines.
- LinkedIn, Facebook, Instagram, TikTok, Threads, YouTube and Discord are link-only, forever, and no vendor
  collects them for us. Product Hunt is not accessed.
- Link sources never fetch anything. They build a search URL the user opens in their own browser.
- Every source has a kill switch, `SOURCE_<ID>_ENABLED`. Collect sources default off, link sources on.
- Budgets: reserve with `consume_budget` before every paid call, settle afterwards, and stop at the limit.
  Vendor sources also respect the global monthly cap. Dedupe within the UTC day.
- Politeness: low request rates, a descriptive User-Agent with a monitored contact, back off on 429.
- Parse every response with zod and keep only the fields the plan stores. Hash the author key at once
  (`src/server/privacy/`); never store, log or return it. Excerpts are at most 280 characters, and every
  stored post links back to the original.
- Deletion sync where the source allows it (Hacker News, Bluesky, X); Reddit relies on its 7-day retention.
- Fixtures only in tests. CI never calls a live third-party API. Fixture capture scripts run by hand.
- Before a collect source ships, confirm its hosts, auth, parameters, fields, price and terms against the
  current official docs and record the date in the module header. Re-read the terms in launch week.

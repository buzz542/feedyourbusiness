# AskedFor: build plan (route C)

Status: the founder chose route C in conversation with Claude on 14 Oct 2026 ("we will go with C") and
asked for this plan to hand to a new Claude Code session; Claude wrote it at the founder's request. Handing
it to the build session is the founder's approval of decisions D1 to D12. It supersedes `docs/BRIEF.md` and
`docs/PRD.md` wherever they disagree; both stay in the repo as history. The task list
with checkboxes and acceptance tests is `docs/TASKS.md`, which follows this plan milestone by milestone.

Who to reply to today. What your rivals get wrong. What to build next.

---

## 0. Read me first

### For Claude Code

1. Read this whole file before your first task, then `CLAUDE.md`, then the milestone you are on in
   `docs/TASKS.md`. Path-scoped rules in `.claude/rules/` load on their own.
2. Work milestone by milestone, in order. One `/goal` per milestone (the lines are in `docs/TASKS.md`).
   Inside a milestone, take the boxes top to bottom unless a box says otherwise.
3. The loop for every box: write the acceptance test first and watch it fail, make the smallest change
   that passes, `npm run check`, ask the `code-reviewer` and `compliance-reviewer` subagents to find
   problems, fix every blocking finding, tick the box, one focused commit.
4. Boxes marked `(you)` are the founder's. Never fake them. If one blocks you, build everything around it
   with fakes and fixtures, leave the box open, and list it in your end-of-milestone summary.
5. Missing secrets never block building. Every external service sits behind a port with a fake. When a
   key is missing, finish the code and tests, and leave the live check for the founder (section 16).
6. Decisions D1 to D12 below are approved once the founder hands this plan to a build session (see the
   status line). Do not reopen them. Anything this plan does not cover that
   touches data sources, stored fields, retention, billing, pricing, public claims, processors, cookies,
   analytics or a new outbound host: stop and ask.
7. Database changes: write and pass the PGlite test, apply the migration to the development project
   (F12) and run the Supabase security and performance advisors there. Production
   (`hoqbflkszzoojdswbrgy`) needs the founder: show the SQL and the passing test, ask, and apply only after a
   yes, then run the advisors again and regenerate `src/types/database.ts`. Destructive statements (a
   dropped column or table) are called out separately in the question.
8. Branches: push your work to the branch your session gives you. CI must be green before you call a
   milestone done. If you can push to the default branch (`claude/askedfor-foundations`, which Vercel
   deploys to production), merge each green milestone into it; if you cannot, open a pull request and
   say so in your summary.
9. Never write an em dash in UI copy, emails or docs. US English. Platform names in text only.

### For the founder

Do the steps in section 15 in the order given. The ones marked "before M1" take about an hour and
unblock most of the build. The rest can happen while Claude Code works. Section 16 tells you how to
check that Vercel, Supabase and Stripe are wired correctly with one request.

Kickoff prompt for the new Claude Code session:

```text
Read docs/PLAN.md in full, then CLAUDE.md and docs/TASKS.md. Work through docs/TASKS.md milestone by
milestone, starting with the first milestone that has an unticked box that is not marked (you). Follow
"The loop" in CLAUDE.md for every box. Do not reopen the decisions in docs/PLAN.md section 1. When a
milestone is done, give me a short summary: what shipped, what you could not verify live and why, and
which (you) boxes block the next milestone.
```

Then, per milestone, paste its `/goal` line from `docs/TASKS.md`.

---

## 1. Decisions

Approved once the founder hands this plan to a build session (see the status line). Do not reopen them.
Changing section 1 or 2 needs the founder's approval; `tests/docs/prd.test.ts` pins both.

- **D1. Route C for data.** Reddit is collected through a contracted data vendor's REST API (default Bright Data, Web Scraper API, Reddit posts dataset). X is collected only through the official X API v2, off by default. Hacker News and Bluesky through their official APIs. LinkedIn, Facebook, Instagram, TikTok, Threads, YouTube and Discord stay search-links only. Product Hunt is not accessed. _Supersedes: Brief: "no scraping services", "Reddit is never collected", "X phase 2"._
- **D2. Three tabs: Reply, Rivals, Build.** Reply matches the lead-feed products on function. Rivals is new: what tracked competitors and other tools in the space get wrong, and who wants to switch. Build keeps the weekly themes and "what to build next". _Supersedes: Brief: two tabs._
- **D3. Parity on function, never on look or words.** Match what lead feeds do (URL to keywords, daily multi-platform feed, relevance scoring, categories, daily email). Never copy any competitor's layout, wording, colors, mascot or illustrations, and never name one on the site. Keep AskedFor's own format and visual direction (section 9).
- **D4. Retention by source.** Reddit and X raw posts are deleted 7 days after collection; Hacker News and Bluesky after 30. The database enforces both. Weekly aggregates (themes, rival insights) are kept without names or quotes. _Supersedes: Brief: 30 days for all._
- **D5. No author handles stored, for any source.** Only a keyed hash (HMAC) of the author id, for suppression and removal. Cards link to the original post instead of showing a username. _Supersedes: Brief: handle "where the Reply tab needs it"._
- **D6. Vercel Pro before launch.** Vercel's Hobby plan is for non-commercial use only and refuses cron jobs that run more than once a day. Until the founder upgrades, every schedule in `vercel.json` stays daily so deploys never fail.
- **D7. Pricing unchanged.** One plan, $29 a month, 7-day trial, card required, reminder 48 hours before the first charge, cancel in two clicks. No X add-on is sold in v1; X stays off unless the founder turns it on.
- **D8. No model ever writes reply text.** Reply tips are fixed copy per category. _Supersedes: Brief: "reply tips" (now defined)._
- **D9. One product per account in v1.** The schema allows more; the UI and a unique index enforce one.
- **D10. Jobs run on Vercel Cron plus a jobs table.** No Inngest or Trigger.dev in v1.
- **D11. Pre-approved changes.** The processors in section 12.4, the outbound hosts in section 7, the dependencies in section 5.3 and the env vars in section 14 are approved as specified. Production migrations are specified in section 6 but each one is applied only after the founder says yes (section 0, item 7). Anything else in those categories needs the founder. _Supersedes: CLAUDE.md "Ask before you" (narrowed for these items only)._
- **D12. Positioning.** The site never says "we don't scrape" or "official APIs only". It says plainly where posts come from, including that Reddit posts come from a third-party data provider (named in the privacy notice and on the sources page). _Supersedes: Brief: "without scraping" positioning, landing trust section, FAQ._

What the founder accepted with D1, in plain words: Reddit's user agreement does not allow collecting its
content without permission, and Reddit has sued scraping providers and a customer of one (Perplexity). Using
a vendor does not transfer that risk to the vendor. The mitigations are in section 19. The licensed route
(a Reddit data agreement) is pursued in parallel (section 15, step F9), and the code keeps Reddit behind a
provider port so a licensed feed can replace the vendor without touching the rest of the product.

---

## 2. Hard rules (route C)

These override everything else in this plan. If a feature cannot be built within them, it is not built.

### 2.1 Data sources

1. Collect only from sources registered in `src/sources/registry.ts`. All outbound HTTP to sources goes
   through `safeFetch()`; `npm run compliance:hosts` fails on any other path or host.
2. Reddit is collected only through the contracted vendor's REST API, called with `safeFetch()`. Never
   fetch reddit.com or redd.it ourselves, never log in to Reddit, never use Reddit accounts or cookies,
   never run a browser against Reddit. Logged-out public posts only. Drop anything the vendor marks as
   NSFW or over 18, and anything from a private or quarantined community.
3. X only through the official X API v2 with a bearer token, a hard daily read budget per product, the
   use case declared honestly to X, deletions honored, and no model training on X content. Off by default.
4. Hacker News through the official Algolia HN Search API and the Firebase item API. Bluesky through its
   official XRPC API from a dedicated AskedFor account, following the Bluesky Developer Guidelines (no
   automated interactions, a monitored public contact email).
5. LinkedIn, Facebook, Instagram, TikTok, Threads, YouTube and Discord are never collected, by us or by a
   vendor. They get search links the user opens. Product Hunt is never accessed.
6. No scraping SDKs, vendor SDKs, headless browsers or stealth tools in the repo. The package lists in
   `compliance/denylist.json` are unchanged by route C (its copy phrases grew, to block claims that hide the
   data provider). Playwright stays a dev dependency for localhost E2E only.
7. Every vendor is a processor. Before its kill switch is turned on in production: a signed DPA, a recorded
   transfer mechanism, a DPIA covering the vendor collection signed off by the founder, and the vendor named
   in the privacy notice and on the sources page (M3 ships a minimal version of both).
8. Every collect source has a kill switch (`SOURCE_<ID>_ENABLED`, default off), a per-product daily budget
   recorded in `usage_ledger` before every paid call, and paid sources also have a global monthly cap.
9. A vendor is used only for the platform it is contracted for. Each source's `ctx.fetch` is bound to that
   source's own `allowedHosts`, and the Reddit module calls only the vendor paths and dataset ids pinned in
   its code (the Reddit posts datasets); any other dataset id is refused before a request is made, whatever
   the env says. Any vendor path that is not pinned (for example a general unlocking or search API on the
   same host) is refused too, and only the `reddit` source may declare `access: "vendor_api"`. The vendor's
   host appears only in `src/sources/reddit*.ts`; other modules import its constant from there. Planted tests
   prove each.
10. The user's own site (`fetchOwnSite()`) and the instant preview refuse every platform host (Reddit, X,
    LinkedIn, Facebook, Instagram, TikTok, Threads, YouTube, Discord, Bluesky, Hacker News, Product Hunt,
    Indie Hackers and their subdomains), from one shared list, so neither becomes a way to fetch a platform.

### 2.2 What users can do

1. AskedFor never posts, replies, votes, follows or messages on any platform. No browser extension.
2. No model writes reply text (D8). Reply tips are fixed copy.
3. Every reply surface shows the disclosure reminder: "Say you built it."
4. The acceptable use policy bans spam, copy-paste mass replies, sock puppets and building contact lists.
5. The service is for people 18 and over.

### 2.3 Privacy (UK GDPR, AskedFor is the controller)

1. Store the minimum for a post: URL, source, community name, posted time, an excerpt of at most 280
   characters, labels, and a keyed hash of the author id. No handles (D5), avatars, bios, follower counts,
   emails or titles beyond what fits in the excerpt.
2. Vendor and API payloads are parsed with zod at the adapter boundary and reduced to those fields in
   memory. Raw payloads are never stored and never logged.
3. Only posts the classifier rates relevant (relevance 40 or more) are stored or shown, the instant preview
   included. Everything else is discarded in memory.
4. Retention per D4, enforced by a database check constraint. Reads exclude rows past `delete_after`, and
   the purge (every tick on Vercel Pro, daily before that) deletes them and clears example ids from
   aggregates. Aggregates hold no names and no quotes.
5. Every write path checks the suppression list in the same statement that inserts (`ingest_post`).
   Removal requests are handled within 30 days (target 72 hours); the admin action deletes and suppresses
   in one click and writes the audit log.
6. Deletion sync: Hacker News and Bluesky posts deleted at the source are deleted here within a day. X
   posts follow X's compliance rules (section 7.6). Reddit posts are re-checked once through the vendor
   about 72 hours after collection and deleted here if they are gone or removed at the source; their 7-day
   retention bounds the rest. Re-checks run before new collection, outside the per-product daily budget,
   with 10 percent of the monthly vendor cap held back for them. The DPIA records the remaining gap (a post
   deleted after the re-check stays until day 7). Turning the re-check off needs the DPIA and the privacy
   notice updated first.
7. Never infer or tag sensitive traits (health, politics, religion, sexuality, ethnicity, and similar).
   No prompt asks for them and no output schema has a field for them. Because a community name next to an
   author hash can reveal such a trait, posts from Reddit communities about health, sexuality, religion,
   politics, ethnicity or similar special-category topics are dropped before classification and storage
   (`src/sources/sensitive-communities.ts`: a list plus name patterns, reviewed by the founder before Reddit
   is switched on and in launch week), and the onboarding draft never suggests such subreddits. Reddit posts made on a user's profile (community `u_<name>`, or a URL
   under `/user/` or `/u/`) are dropped too, because they carry the username.
8. Row-level security on every table, explicit grants, `anon` gets nothing, secrets server-side only,
   append-only audit log for admin actions.
9. Cookies: essential only (the Supabase auth session). Analytics are first-party and cookieless
   (section 12.6). No third-party analytics, pixels or trackers.
10. Logs, errors and analytics never contain post text, emails, handles, request bodies or Stripe
    payloads. Log error class names only.
11. Before launch: ICO fee, Legitimate Interests Assessment, DPIA (covering vendor collection and
    invisible processing), Article 14 notice linked in every footer, DPAs with every processor.
12. What the vendor collects and keeps counts too: request only the fields we use if the vendor's API
    allows it, delete or expire snapshots after download where it allows it, and record the vendor's
    snapshot retention in the DPA, `docs/legal/processors.md` and the privacy notice. Public retention claims
    say "deleted from AskedFor".
13. Committed test fixtures are synthetic or scrubbed: invented authors and text, never a real person's
    username, id or post. A live capture is run by the founder on their own machine: the script writes to the
    git-ignored `fixtures-local/`, checks the response against the schema there, prints pass or fail and the
    field names only, then deletes the capture. Real responses never enter the build session.
14. Emails and exports carry links, sources, communities, ages and our own one-line reasons, never post
    excerpts, so retention promises hold outside the database too.

### 2.4 Payments and consumer law

As in the brief: a merchant of record (Stripe Managed Payments) handles VAT and sales tax; the full price
is shown up front, tax included where it applies (no drip pricing); price, renewal and cancellation terms
appear before checkout; a reminder goes out at least 48 hours before the first charge; cancellation online
is as easy as signing up (two clicks); express consent to start the service during the cancellation period
is recorded (wording per the solicitor); live mode stays locked until the founder unlocks it
(`docs/BILLING.md`).

### 2.5 Marketing and launch

As in the brief, plus D12: no fake or AI-written testimonials, reviews, user counts, badges or
screenshots; example data labeled "Example", invented, and showing no handles; no competitor named on the site or in
ads; every claim and every number in `docs/claims.md`; no upvote requests; marketing email needs consent
and an unsubscribe link; never use scraped email addresses.

---

## 3. What exists today: keep, alter, remove

Everything below is on branch `claude/askedfor-foundations` (the repo's default and production branch).

### 3.1 Keep as is

| Area     | What                                                                                                                                                                                       | Where                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| App      | Next.js 16.4 App Router, React 19.3, TypeScript 5.9 strict, Tailwind 4.3, ESLint 9, Prettier, Node 22                                                                                      | `package.json`, `tsconfig.json`, `eslint.config.mjs`       |
| Tests    | Vitest, PGlite database tests with Supabase roles and `auth.uid()`, hook tests                                                                                                             | `vitest.config.mts`, `tests/db/harness.ts`, `tests/hooks/` |
| Network  | `safeFetch()` (https only, exact host allowlist, no credentials, redirects re-checked)                                                                                                     | `src/server/net/`                                          |
| Gates    | `compliance:hosts`, `:deps`, `:schema`, `:copy` and their planted-violation tests                                                                                                          | `compliance/`, `tests/compliance/`                         |
| Database | Core schema, RLS and grants, billing functions (3 migrations, applied to production)                                                                                                       | `supabase/migrations/`                                     |
| Billing  | Checkout (trial, card required, renewal terms, Managed Payments), webhook (signature, bounded body, idempotent, ordering-safe), cancel and resume, portal, trial reminders, live-mode lock | `src/server/billing/`, `src/app/api/billing/`              |
| Ops      | `/api/health` (liveness, plus full checks with the cron secret), daily trial-reminder cron                                                                                                 | `src/server/health/`, `src/app/api/health/`                |
| Email    | Trial reminder template                                                                                                                                                                    | `emails/trial-reminder.ts`                                 |
| Site     | Marketing layout, footer, placeholder legal pages, color tokens with dark mode                                                                                                             | `src/app/(marketing)/`, `src/app/globals.css`              |
| Process  | Hooks, two review subagents, path-scoped rules, CI workflow                                                                                                                                | `.claude/`, `scripts/hooks/`, `.github/workflows/ci.yml`   |

Never edit a migration that is already applied. Add new ones.

### 3.2 Alter

| What             | Change                                                                                                                                            | Milestone |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `posts`          | Sources gain `reddit` and `x`; per-source retention check (D4); `community` column; inserts only through `ingest_post`                            | M3        |
| `product_posts`  | Rival columns, highlight offsets, matched term; new indexes                                                                                       | M4        |
| `products`       | `competitors text[]` becomes the `competitors` table; add `one_liner`, `subreddits`, `confirmed_at`, `relevance_threshold`; one product per owner | M2        |
| `profiles`       | `is_admin`, email preferences, `terms_accepted_at`, `service_consent_at`                                                                          | M1, M8    |
| `themes`         | `kind` and `theme_key` for trends                                                                                                                 | M7        |
| Source contract  | `access`, `retentionDays`, two-phase `start` and `poll` for vendor runs                                                                           | M3        |
| `vercel.json`    | Pipeline crons; the Pro schedule once the founder upgrades (D6)                                                                                   | M3        |
| Copy gate        | Also scans app UI for em dashes, hype words, UK spellings and competitor names (not the numbers rule)                                             | M1        |
| Hosts gate       | Allows `node:https` and `node:dns` in exactly one more file, `src/server/net/own-site.ts`                                                         | M2        |
| Home page        | Becomes the landing page (section 9.6)                                                                                                            | M9        |
| `docs/claims.md` | Rows for every claim and number on the landing, pricing and sources pages                                                                         | M8, M9    |

Already altered on 14 Oct 2026 for route C: `CLAUDE.md`, `.claude/rules/*`, the compliance reviewer, the
registry test (Reddit can now be collected, never fetched directly), the Reddit link source renamed to
`reddit_links`, `vercel.json` made Hobby-safe with functions in London (`lhr1`), Node pinned to 22.x,
`/api/health` added.

### 3.3 Remove

Nothing functional. Retire the "without scraping" positioning wherever it appears (D12). `docs/PRD.md`
and `docs/PHASE0-FINDINGS.md` stay as history with a pointer to this plan.

---

## 4. Product

### 4.1 Users and the three jobs

Indie makers and small software teams (one to a handful of people), 18 or older, before or just after
product-market fit, who reply to people in their own words. Not agencies, not outreach at volume.

1. **Reply:** every morning, public posts where someone asks for a tool like yours, describes the problem
   you solve, mentions you, or mentions a rival. You open the post and reply yourself, saying you built it.
2. **Rivals:** what your competitors and other tools in your space get wrong, counted by issue and week,
   with the people who want to switch, and what you could fix that they do not.
3. **Build:** the patterns behind the posts: themes with counts and trends, what people wish existed, and
   a weekly "what to build next" digest.

### 4.2 Routes

| Route                                               | Who       | What                                                                         |
| --------------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `/`                                                 | public    | Landing page (section 9.6) with the instant preview                          |
| `/pricing`                                          | public    | One plan, full terms before checkout                                         |
| `/sources`                                          | public    | Every registered source, how it is accessed, retention, the data provider    |
| `/privacy`, `/terms`, `/acceptable-use`, `/cookies` | public    | Legal pages (drafts until the solicitor signs off)                           |
| `/remove-my-post`                                   | public    | Removal form                                                                 |
| `/login`                                            | public    | Magic link and Google sign-in, 18+ and terms confirmation                    |
| `/auth/callback`                                    | public    | Route handler: exchanges the auth code, then redirects to a safe `next` path |
| `/app`                                              | signed in | Redirects to the right step: onboarding, billing or Reply                    |
| `/app/onboarding`                                   | signed in | URL, draft review, confirm                                                   |
| `/app/billing`                                      | signed in | Start the trial: price, renewal, cancellation, consent, then Stripe Checkout |
| `/app/reply`                                        | entitled  | Reply tab                                                                    |
| `/app/rivals`                                       | entitled  | Rivals tab                                                                   |
| `/app/build`                                        | entitled  | Build tab                                                                    |
| `/app/settings`                                     | signed in | Plan and billing, email, product, search terms, competitors, sources, data   |
| `/admin`                                            | admin     | Removal queue, source health, costs, metrics                                 |
| `/api/billing/*`, `/api/cron/*`, `/api/health`      | existing  | Unchanged contracts                                                          |
| `/api/preview`                                      | public    | Instant preview (POST)                                                       |
| `/api/removal`                                      | public    | Removal form submit (POST)                                                   |
| `/api/unsubscribe`                                  | public    | One-click unsubscribe (GET shows a confirm page, POST applies; RFC 8058)     |
| `/api/export`                                       | signed in | Data export (JSON or Markdown)                                               |

"Entitled" means `subscription_status` is `trialing` or `active` (`isEntitled` in
`src/server/billing/subscription.ts`). Collection runs only for entitled accounts with a confirmed product.

### 4.3 Onboarding

1. **Sign in** with a magic link or Google. First sign-in asks for two confirmations on one screen: "I am
   18 or older" and "I agree to the Terms and the Acceptable use policy" (stored as `terms_accepted_at`).
2. **Paste your product URL.** `fetchOwnSite()` fetches it once (section 12.3). If the fetch fails, the user
   can paste a description instead.
3. **Draft** (Sonnet, section 8.3) within 2 minutes: name, one-line summary, description, audience, up to 8
   competitors (name and domain), 20 to 30 search terms with an intent label, and up to 10 suggested
   subreddits (used for search links and to steer Reddit terms). A progress state shows what is happening.
4. **Review and edit** every field: inline edit, add and remove terms (chips, max 40), add and remove
   competitors (name, optional domain, optional aliases), relevance threshold (default 60).
5. **Confirm.** The product becomes `active` with `confirmed_at`. Nothing is collected before this, and
   nothing is collected until the account is entitled.
6. **Start the trial** at `/app/billing`, then Stripe Checkout. On return, the first run starts at once
   (section 7.3) and the Reply tab shows a progress state until it finishes; an email says when it is ready.

### 4.4 Reply tab

- **Views:** Today (collected in the last 24 hours, not replied or hidden), All (everything still stored,
  not hidden), Saved, Replied. Counts on each.
- **Filters:** category (Looking for a tool, Pain point, Mentions you, Mentions a rival, Wish), source
  (Reddit, Hacker News, Bluesky, X when on), rival, minimum match (40 to 95, default from the product),
  and text search within excerpts. Filters live in the URL so a view can be bookmarked.
- **Sort:** match score, then newest.
- **Card:** source and community ("Reddit · r/SaaS", "Hacker News", "Bluesky"), age ("3h"), category tag,
  match score, the excerpt with the highlighter mark over the words that ask for something, "Why it
  matched" (the classifier's one-line reason), rival chip when one is mentioned, and actions: Open post (new
  tab, `rel="noopener noreferrer"`), Save, Mark replied, Hide, Undo. A collapsible reply tip (D8) and the
  line "Say you built it." sit next to Open post on every card.
- **Keyboard:** `j` and `k` move, `o` opens, `s` saves, `r` marks replied, `h` hides, `?` shows the keys.
- **Search links panel:** for each term, one-tap searches on Reddit, X, LinkedIn, Facebook, Threads and
  Indie Hackers, opened in the user's browser, with the line "Say you built it." above them.
- **Pagination:** 50 cards per page with "Load more". 200 cards must render in under 1.5 seconds.
- **Daily email:** "New posts worth replying to" each morning when there are any, on by default, one click
  to turn off (section 11). It lists source, community, age, category and our one-line reason with a link to
  the card in the app; it never copies post excerpts (2.3.14).

### 4.5 Rivals tab

- **Rival picker:** All tracked rivals, each tracked competitor, and Discovered (tools people in your space
  mention that you do not track).
- **This week, per rival:** complaints (negative or mixed posts), people looking to switch, top issues with
  counts and a trend arrow against last week. Issues: pricing, reliability, missing feature, support,
  usability, performance, integrations, other.
- **Where they fall short:** issue breakdown as a bar list for this week and the last 8 weeks (sparkline).
- **People looking to switch:** cards (same component as Reply, with "Say you built it.") for posts with
  switching intent. These are the warmest leads in the product.
- **What you could fix:** up to 3 opportunities from the weekly synthesis (section 8.4), each with its
  evidence posts while they are still stored, linked with "Say you built it.". No quotes and no names, ever.
- **Discovered:** tool names mentioned in classified posts that are not tracked, with mention counts and a
  Track button that adds the tool as a competitor and offers "<tool> alternative" as a search term.
- **Export:** the week's rival report as Markdown.

### 4.6 Build tab

- **Themes this week:** up to 8, each with kind (ask, wish, pain), count, trend, a summary in our own
  words, and up to 3 linked excerpts while the posts exist.
- **Wished it existed** and **What to build next** (up to 3 opportunities across asks, wishes and rival
  gaps), each with evidence. Wherever Build links to posts, "Say you built it." is shown.
- **Week picker** for history. Aggregates are kept after the posts expire.
- **Export** as Markdown, and the Monday digest (section 11).
- No author names or handles anywhere in Build or Rivals (none are stored, D5, and summaries are checked).

### 4.7 Settings

- **Plan and billing:** status and dates in plain words ("Trial ends October 21, 2026. Then $29 a month."),
  Cancel subscription (one click opens the confirm step, the second click cancels at period end), Resume,
  Update card (Stripe portal).
- **Email:** daily posts email on or off, Monday digest on or off.
- **Product:** name, one-liner, description, audience, URL, relevance threshold, pause collection.
- **Search terms:** list with per-term stats for the last 7 days (fetched, relevant), add, pause, remove.
- **Competitors:** name, domain, aliases; add and remove.
- **Sources:** per-product toggles for each enabled collect source.
- **Data:** export everything (JSON) and delete the account (type DELETE to confirm; cancels the
  subscription at once and deletes all data, section 10.5).

### 4.8 Admin

Visible only when `profiles.is_admin` is true (set by the founder in SQL; no API role can write it).

- **Removal queue:** requests ordered by due date. One click "Delete and suppress" removes matching posts,
  adds the author hash to `suppression`, closes the request, emails the requester and writes `audit_log`.
  A request with a post link is matched by source and external id, and that post's stored author hash is
  suppressed. A request with a username is hashed as in 12.5 for Reddit and Hacker News; a Bluesky handle is
  first resolved to its DID (`com.atproto.identity.resolveHandle`) and an X username to its user id
  (`GET /2/users/by/username/:username`), through the hosts those sources already allow, because those
  sources hash the stable id, not the handle.
- **Source health:** last run per source, failures by error class, budget used today, vendor records this
  month against the cap, kill switch state (read-only).
- **Costs:** vendor and model spend per day and per product, from `usage_ledger` and `llm_usage`.
- **Metrics:** activation, weekly active users, replies marked per user per week, trial-to-paid, from `events`.

### 4.9 States

Every list has a loading state (skeleton cards), an empty state that says what to do next (add terms, lower
the threshold, open search links), and an error state with a retry. The first run shows progress by source.

---

## 5. Architecture

### 5.1 Layout

```
src/
  app/
    (marketing)/          public pages, copy rules apply
    (app)/app/            signed-in app: onboarding, billing, reply, rivals, build, settings
    (admin)/admin/        admin pages
    auth/callback/        route handler
    api/                  thin route handlers only
  components/ui/          Button, Chip, Card, Tag, Tabs, Dialog, Toast, EmptyState, Skeleton, Highlight, Sparkline
  components/app/         PostCard, FilterBar, RivalScorecard, ThemeCard, SearchLinksPanel
  proxy.ts                Next 16 proxy (formerly middleware): session refresh, route protection
  server/
    auth/                 session helpers, entitlement and next-step logic
    billing/              existing
    email/                mailer, unsubscribe tokens
    health/               existing
    http/                 existing helpers
    llm/                  Anthropic client port, prices, usage logging, prompts, schemas
    net/                  safeFetch, own-site fetch, host lists
    pipeline/             jobs runner, steps, budgets, ingest
    privacy/              author hashing, purge, removal handling
    store/                Supabase queries per feature (feed, rivals, build, settings, admin)
    supabase/             existing clients
  sources/                registry, link sources, hackernews, bluesky, reddit (vendor), x
emails/                   templates (US English, no em dashes, no tracking pixels)
supabase/migrations/      new migrations per milestone
tests/                    db, compliance, deploy, docs, hooks, e2e
```

### 5.2 How requests flow

- **Reads in the app:** server components call `src/server/store/*` with the user-scoped Supabase client,
  so RLS applies to every query.
- **Writes in the app:** server actions validate input with zod, then write with the user-scoped client.
  Columns a user may write are narrowed by column grants.
- **Service role:** only in `src/server/` modules for the pipeline, webhooks, crons, admin actions,
  account deletion and the preview. Every admin action writes `audit_log`.
- **Route handlers** stay thin: build deps, call a factory such as `createCheckoutHandler(deps)`, return
  its response, wrapped in `guard()`.

### 5.3 Dependencies (pre-approved, D11)

Pin exact versions, as the repo does.

| Package                         | Why                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `@anthropic-ai/sdk`             | Model calls (processor SDK; `api.anthropic.com` is already a processor host) |
| `geist`                         | UI sans font, self-hosted from the package (no request to a font CDN)        |
| `@fontsource-variable/fraunces` | Editorial serif for headings, self-hosted                                    |
| `@playwright/test` (dev)        | Localhost E2E only; Chromium is preinstalled in Claude Code cloud sessions   |

No other runtime dependency without asking. HTML-to-text, Markdown export, sparklines and rate limiting are
small enough to write.

### 5.4 Ports and fakes

Business logic depends on ports, with in-memory fakes in tests, like `src/server/billing/ports.ts`:
`LlmClient`, `SourceFetch` (safeFetch), `Mailer`, `BillingStripe`, `JobStore`, `PostStore`, `Clock`.
Every function with time logic takes `now`.

---

## 6. Data model and migrations

Each migration has a test in `tests/db/` written first, runs in PGlite exactly as in production, is applied
to the development project, and reaches `hoqbflkszzoojdswbrgy` only after the founder approves it (section 0,
item 7). Name each file with the version
Supabase records. New tables ship with RLS, explicit grants and negative tests (another user's rows,
columns a user must not write, anon gets nothing). Functions are `security invoker` unless stated, use
`set search_path = ''`, take `p_now` instead of calling `now()` where time matters, and are executable by
`service_role` only.

### 6.1 M1 `profiles_app` (profiles additions, events)

```sql
alter table public.profiles
  add column is_admin boolean not null default false,
  add column email_daily boolean not null default true,
  add column email_weekly boolean not null default true,
  add column terms_accepted_at timestamptz;
grant update (email_daily, email_weekly, terms_accepted_at) on public.profiles to authenticated;

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (name in (
    'signed_up', 'product_confirmed', 'checkout_started', 'trial_started', 'feed_opened',
    'rivals_opened', 'build_opened', 'post_saved', 'post_replied', 'post_hidden',
    'digest_opened', 'subscription_canceled', 'account_deleted')),
  props jsonb not null default '{}' check (pg_column_size(props) <= 1024),
  at timestamptz not null default now()
);
alter table public.events enable row level security;
create policy events_deny_all on public.events for all to anon, authenticated using (false) with check (false);
create index events_name_at_idx on public.events (name, at);
```

Test: a user cannot set `is_admin` or any billing column on their own row; can set the three new columns;
`events` is invisible to anon and authenticated.

### 6.2 M2 `onboarding` (competitors table, product fields, model usage)

```sql
create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  domain text check (domain is null or (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(domain) <= 253)),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 10),
  origin text not null default 'user' check (origin in ('user', 'draft', 'discovered')),
  created_at timestamptz not null default now(),
  unique (product_id, name)
);
-- Move existing values, then drop the array (production has no products yet; verify the count first).
insert into public.competitors (product_id, name, origin)
  select p.id, c.name, 'user' from public.products p, unnest(p.competitors) as c(name)
  on conflict do nothing;
alter table public.products drop column competitors;

alter table public.products
  add column one_liner text check (char_length(one_liner) <= 160),
  add column subreddits text[] not null default '{}' check (cardinality(subreddits) <= 10),
  add column confirmed_at timestamptz,
  add column relevance_threshold smallint not null default 60 check (relevance_threshold between 40 and 95);
create unique index products_one_per_owner on public.products (owner_id);  -- D9

alter table public.search_terms
  add column intent text not null default 'problem'
    check (intent in ('problem', 'category', 'alternative', 'competitor')),
  add column paused boolean not null default false;

create table public.llm_usage (
  id bigint generated always as identity primary key,
  product_id uuid references public.products (id) on delete set null,
  task text not null check (task in ('draft', 'classify', 'synthesize', 'preview')),
  model text not null,
  input_tokens integer not null, output_tokens integer not null,
  cache_read_tokens integer not null default 0, cache_write_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null,
  created_at timestamptz not null default now()
);
```

RLS for `competitors`: owner (through `products.owner_id`) can select, insert, update `(name, domain,
aliases)` and delete; mirror the `search_terms` policies. `llm_usage` (needed by the onboarding draft) is
deny-all for API roles. Test: another user's competitors are invisible and unwritable; a second product for
the same owner is refused; `llm_usage` is invisible to anon and authenticated.

### 6.3 M3 `collection` (posts, jobs, budgets, ingest, purge)

```sql
alter table public.posts drop constraint posts_source_check;
alter table public.posts add constraint posts_source_check
  check (source in ('hackernews', 'bluesky', 'reddit', 'x'));
alter table public.posts add constraint posts_retention_by_source check (
  delete_after <= collected_at + case when source in ('reddit', 'x')
    then interval '7 days' else interval '30 days' end);   -- D4
alter table public.posts add column community text check (char_length(community) <= 100);
-- D5, enforced: no handle is ever stored.
alter table public.posts add constraint posts_no_author_handle check (author_handle is null);
-- Customers see a post's content, never its author hash (which would link one author's posts).
revoke select on public.posts from authenticated;
grant select (id, source, url, excerpt, posted_at, collected_at, community) on public.posts to authenticated;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('collect', 'deletion_sync', 'purge', 'synthesize',
    'digest_daily', 'digest_weekly', 'first_run')),
  product_id uuid references public.products (id) on delete cascade,
  source text,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'done', 'failed')),
  payload jsonb not null default '{}' check (pg_column_size(payload) <= 8192),
  attempts smallint not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 120),   -- error class only
  dedupe_key text unique,                                   -- e.g. collect:<product>:<source>:<utc day>
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_due_idx on public.jobs (status, run_after);

create table public.term_stats (
  term_id uuid not null references public.search_terms (id) on delete cascade,
  source text not null,
  day date not null,
  fetched integer not null default 0 check (fetched >= 0),
  relevant integer not null default 0 check (relevant >= 0),
  primary key (term_id, source, day)
);
```

Functions (service role only):

- `ingest_post(...)` with `p_source, p_external_id, p_url, p_excerpt, p_posted_at, p_author_hash,
p_community, p_now`, returning a uuid: null without inserting when `(p_author_hash, p_source)` is in `suppression`;
  otherwise inserts with `delete_after = p_now + retention(p_source)` and returns the id; on conflict
  `(source, external_id)` it changes nothing and returns the existing id (retention is never extended).
- `claim_jobs(p_now, p_limit, p_lease_seconds) returns setof jobs`: `for update skip locked`, picks
  `queued` or `waiting` jobs with `run_after <= p_now` and an expired or empty lease, sets `running`,
  bumps `attempts`, sets `locked_until`.
- `finish_job(p_id, p_status, p_error_class, p_payload, p_run_after)`: ends or reschedules a job.
- `consume_budget(p_product_id, p_source, p_day, p_units, p_limit) returns boolean`: atomic upsert into
  `usage_ledger` that reserves `p_units` only if `reads + p_units <= p_limit`.
- `settle_budget(p_product_id, p_source, p_day, p_reserved, p_actual, p_cost_usd)`: returns unused units
  (`p_reserved - p_actual`) and adds the actual cost, after the call.
- `vendor_usage(p_source, p_month_start) returns integer`: records used this month across all products.
- `purge_expired(p_now) returns jsonb`: deletes posts past `delete_after`; deletes posts no product links
  to after 1 day; removes deleted post ids from `themes.example_post_ids` and
  `rival_insights.example_post_ids` (once that table exists); deletes `preview_runs` past `expires_at`,
  closed `removal_requests` 12 months after `handled_at`, `events` older than 13 months and finished
  `jobs` older than 30 days; returns counts.

RLS: `jobs` deny-all; `term_stats` owner-read through the term's product. Tests: an author handle cannot be
written (planted); `authenticated` cannot select `author_hash` or `author_handle`; retention cap per
source, suppressed author never stored, retention not extended on conflict, two concurrent claims never
take the same job, budget refuses the call that would cross the limit, purge clears example ids.

### 6.4 M4 `classification` (labels)

```sql
alter table public.product_posts
  add column competitor_id uuid references public.competitors (id) on delete set null,
  add column tool_mentioned text check (char_length(tool_mentioned) <= 60),
  add column rival_issue text check (rival_issue in ('pricing', 'reliability', 'missing_feature',
    'support', 'usability', 'performance', 'integration', 'other')),
  add column rival_sentiment text check (rival_sentiment in ('negative', 'mixed', 'positive')),
  add column switching boolean not null default false,
  add column rival_summary text check (char_length(rival_summary) <= 200),
  add column highlight_start smallint check (highlight_start between 0 and 280),
  add column highlight_end smallint check (highlight_end between 1 and 280),
  add column term_id uuid references public.search_terms (id) on delete set null,
  add constraint product_posts_highlight_range
    check ((highlight_start is null) = (highlight_end is null) and (highlight_end is null or highlight_end > highlight_start));
create index product_posts_today_idx on public.product_posts (product_id, created_at desc)
  where state in ('new', 'saved');
create index product_posts_rival_idx on public.product_posts (product_id, competitor_id, created_at desc)
  where competitor_id is not null;
```

The `compliance:schema` banned-column rule must still pass for the post tables. Test: the user can still
update only `state` on `product_posts`.

### 6.5 M6 `rivals`

```sql
create table public.rival_insights (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  competitor_id uuid references public.competitors (id) on delete cascade,
  tool_name text check (char_length(tool_name) <= 60),        -- discovered tools, product names only
  week date not null,                                         -- Monday of the ISO week, UK time
  issue text not null check (issue in ('pricing', 'reliability', 'missing_feature', 'support',
    'usability', 'performance', 'integration', 'other')),
  complaints integer not null check (complaints >= 0),
  switching integer not null check (switching >= 0),
  trend text not null default 'flat' check (trend in ('up', 'down', 'flat', 'new')),
  summary text not null check (char_length(summary) <= 600),
  example_post_ids uuid[] not null default '{}' check (cardinality(example_post_ids) <= 3),
  created_at timestamptz not null default now(),
  check (competitor_id is not null or tool_name is not null)
);
create unique index rival_insights_week_uq on public.rival_insights
  (product_id, coalesce(competitor_id::text, lower(tool_name)), week, issue);
```

Owner reads through the product; service role writes. Update `purge_expired` to clear its example ids.

### 6.6 M7 `build_themes`

```sql
alter table public.themes
  add column kind text not null default 'ask'
    check (kind in ('ask', 'wish', 'pain', 'opportunity', 'rival_fix')),
  add column theme_key text check (theme_key ~ '^[a-z0-9-]{1,60}$');
create index themes_product_week_idx on public.themes (product_id, week desc);
```

### 6.7 M8 `billing_consent`

```sql
alter table public.profiles add column service_consent_at timestamptz;   -- written by the webhook only
```

### 6.8 M9 `launch` (preview, removal requests)

```sql
create table public.preview_runs (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,                      -- HMAC of IP and UTC day; never the IP
  url_host text not null check (char_length(url_host) <= 253),
  result jsonb not null check (pg_column_size(result) <= 20000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (expires_at <= created_at + interval '24 hours')
);
create index preview_runs_ip_idx on public.preview_runs (ip_hash, created_at);

alter table public.removal_requests
  add column source text check (source in ('hackernews', 'bluesky', 'reddit', 'x')),
  add column details text check (char_length(details) <= 1000),
  add column ip_hash text;
```

`preview_runs` and `removal_requests` stay deny-all for API roles.

---

## 7. Sources and the collection pipeline

### 7.1 Source contract v2 (`src/sources/types.ts`)

```ts
interface CollectSource extends SourceBase {
  readonly mode: "collect";
  readonly access: "official_api" | "vendor_api";
  /** Required when access is vendor_api: who collects for us, and their DPA. */
  readonly vendor?: { readonly name: string; readonly dpaUrl: string };
  readonly retentionDays: 7 | 30; // D4: 7 for reddit and x, 30 for the rest
  readonly costPerUnitUsd: number; // 0 for free APIs
  /** Hosts that appear in stored links back to posts. Never fetched. */
  readonly linkHosts: readonly string[];
  start(ctx: CollectContext): Promise<RunState>; // free APIs finish at once; vendors return a handle
  poll?(ctx: CollectContext, handle: string): Promise<RunState>;
  /** Deletion sync: the external ids that no longer exist at the source. */
  checkDeleted?(ctx: CollectContext, externalIds: readonly string[]): Promise<string[]>;
}
type RunState =
  | { kind: "done"; posts: CollectedPost[]; units: number }
  | { kind: "pending"; handle: string }
  | { kind: "failed"; errorClass: string };
interface CollectedPost {
  externalId: string;
  url: string;
  excerpt: string;
  postedAt: Date;
  authorKey: string; // the platform's author id; hashed by the pipeline, never stored or logged
  community: string | null; // "r/SaaS", "Hacker News", "Bluesky", "X"
  termId: string | null;
  nsfw: boolean;
}
```

Each source gets its own `ctx.fetch`, a `safeFetch` bound to that source's `allowedHosts` only (2.1.9), so
one source can never call another source's host. Registry tests to add: vendor sources declare `vendor`;
`retentionDays` is 7 for `reddit` and `x`; no
`allowedHosts` entry matches a platform's own domain (the existing hosts gate already enforces this); every
`linkHosts` entry is refused by `safeFetch`. The kill switch for each collect source defaults off.

### 7.2 Jobs

| Job             | When                                            | What                                                                                |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `collect`       | daily, per entitled product, per enabled source | budget check, `start`, `poll` until done (max 60 minutes), filter, classify, ingest |
| `first_run`     | once, right after checkout                      | like `collect` for every source, 7-day window, twice the daily budget               |
| `deletion_sync` | daily, per source                               | Hacker News and Bluesky existence checks; X compliance (7.6)                        |
| `purge`         | every tick on Pro (daily on Hobby)              | `purge_expired(now)`                                                                |
| `synthesize`    | Sunday 21:00 UTC                                | Build and Rivals synthesis per product with 5 or more relevant posts that week      |
| `digest_daily`  | daily, 08:00 Europe/London                      | daily posts email to opted-in users with new posts                                  |
| `digest_weekly` | Monday, 08:00 Europe/London                     | Monday digest                                                                       |

The runner (`src/server/pipeline/runner.ts`) claims up to 10 jobs with `claim_jobs`, runs each step under a
time budget (240 of the 300 seconds a function may run), and finishes or reschedules it. Every step is
idempotent: re-running it after a crash never double-charges a budget, double-inserts a post or double-sends
an email (dedupe keys, `on conflict do nothing`, claim-then-send as in the trial reminders). Three failures
mark a job `failed` with the error class; `/admin` shows it.

### 7.3 One `collect` run, step by step

1. Load the product (confirmed, not paused, owner entitled), its active terms, its source toggles.
2. Choose terms. Free sources: every active term (max 40). Reddit: the 12 terms least recently collected for
   Reddit (from `term_stats`), `num_of_posts` = daily budget / terms, between 5 and 20.
3. Reserve budget with `consume_budget` for the most units the call can cost. Vendor sources also check
   `vendor_usage(source, this month) + units <= BRIGHTDATA_MONTHLY_RECORD_CAP`. If either fails, finish with
   reason `budget` or `monthly_cap` (shown in `/admin`).
4. `start()`. If pending, store the handle, set `waiting`, `run_after` now plus 2 minutes; later ticks `poll`.
5. When done: drop NSFW, drop posts older than the window (48 hours for daily runs, 7 days for the first run),
   hash authors (12.5), drop authors on the suppression list (cheap pre-check before paying for the model).
6. Skip posts this product already has. Posts stored for another product are classified for this one.
7. Classify in batches of 20 (8.2). Discard relevance below 40 and `not_relevant`.
8. `ingest_post` (refuses suppressed authors atomically), then insert `product_posts` with the labels,
   `on conflict (product_id, post_id) do nothing`.
9. `settle_budget` with the actual units and cost; update `term_stats` (fetched, relevant).

Checkout returns to `/app/reply?welcome=1&session_id={CHECKOUT_SESSION_ID}`. The welcome step retrieves that
Checkout Session server-side, checks its `client_reference_id` is the signed-in user, and applies the billing
patch before any entitlement check, so a new subscriber is never shown the billing page (or able to start a
second checkout) while the webhook is still on its way. The first run is then started by a server action that enqueues
`first_run` (dedupe key `first_run:<product>`) and processes it with `after()`, so results stream in while
the user watches. The tick finishes anything still pending. On the Hobby plan only the daily cron ticks, so
a pending vendor run may finish the next morning; that is acceptable before launch (D6).

### 7.4 Hacker News (official, free)

- Search: `https://hn.algolia.com/api/v1/search_by_date?query=<term>&tags=(story,comment)&numericFilters=created_at_i><unix>&hitsPerPage=<n>`.
- Existence: `https://hacker-news.firebaseio.com/v0/item/<id>.json`; `null`, `deleted: true` or
  `dead: true` means delete here.
- Link: `https://news.ycombinator.com/item?id=<objectID>`. Community "Hacker News". Author key: `author`.
- Excerpt: story title plus story text, or comment text; HTML stripped, entities decoded, 280 characters.
- Hosts: `hn.algolia.com`, `hacker-news.firebaseio.com`; link host `news.ycombinator.com`.
- Budget 300 items per product per day. Sequential requests, at most 2 per second, a descriptive
  User-Agent with the contact email, back off on 429.
- Fixtures are synthetic: shaped like the documented responses, with invented authors and text (2.3.13).

### 7.5 Bluesky (official, free, dedicated account)

- The founder creates a Bluesky account for AskedFor with a monitored contact email in its profile and an
  app password (F7). Env: `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD`.
- Session: `POST https://bsky.social/xrpc/com.atproto.server.createSession`. At most one session per
  function invocation, reused across jobs (Bluesky limits session creation per account per day).
- Search: `app.bsky.feed.searchPosts` with `q`, `sort=latest`, `since`, `limit`, authenticated. Confirm
  against docs.bsky.app which host serves it for an authenticated account (the entryway `bsky.social` or the
  account's PDS host from the session); list exactly the hosts used, never a wildcard. Unauthenticated public search has been
  returning 403, so do not rely on it.
- Existence: `app.bsky.feed.getPosts` with up to 25 URIs; missing URIs are deleted here.
- Link: `https://bsky.app/profile/<did>/post/<rkey>` (DID, never the handle). Author key: the DID. A DID is a
  stable public id that resolves to the handle, so the DPIA and the privacy notice say links carry it.
- Posts with adult self-labels (`porn`, `sexual`, `nudity`, `graphic-media`) count as NSFW and are dropped.
- Budget 300 posts per product per day. Read-only: no likes, follows, posts or messages, ever.

### 7.6 X (official API, off by default)

- `GET https://api.x.com/2/tweets/search/recent` with `query="<term>" -is:retweet lang:en`, `start_time`,
  `max_results`, `tweet.fields=created_at,author_id,lang,possibly_sensitive`.
- Budget `X_DAILY_READS_PER_PRODUCT` (default 0, which means no calls even if the switch is on). Pay-per-use
  price per post read is about $0.005 (confirm in the X developer console before enabling).
- Link: `https://x.com/i/web/status/<id>`. Author key: `author_id`. Drop `possibly_sensitive`.
- Deletion compliance: before X is enabled, confirm in X's current docs how a pay-per-use app meets the
  deletion requirement (batch compliance jobs or lookups), implement it in `checkDeleted`, and list any extra
  hosts it needs. Until that exists the source refuses to start, whatever the env says.
- Never use X content to train or fine-tune any model.

### 7.7 Reddit (vendor: Bright Data Web Scraper API)

- Provider port `RedditProvider` with one implementation, `brightdata` (`REDDIT_PROVIDER=brightdata`). A
  licensed Reddit feed can replace it later without touching the pipeline.
- Pinned: the module hard-codes the Reddit posts dataset id(s) and the paths below (plus a snapshot delete
  path if the API has one). Every other path on the vendor host is refused.
  `BRIGHTDATA_REDDIT_DATASET_ID` must equal a pinned id or the source refuses to start, and a request with
  any other `dataset_id` (for example a LinkedIn or Instagram dataset) is refused before it is sent (2.1.9).
- Trigger: `POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=<BRIGHTDATA_REDDIT_DATASET_ID>&type=discover_new&discover_by=keyword&include_errors=true`
  with `Authorization: Bearer <BRIGHTDATA_API_TOKEN>` and a JSON array of inputs
  `{ "keyword", "date", "num_of_posts", "sort_by" }`. Returns `{ "snapshot_id" }`.
- Progress: `GET https://api.brightdata.com/datasets/v3/progress/<snapshot_id>` (`running`, `ready`, `failed`).
- Download: `GET https://api.brightdata.com/datasets/v3/snapshot/<snapshot_id>?format=json`, read with a
  5 MB cap.
- First task of this source (verify, then record the date in the module header): the dataset id for
  "Reddit posts, discover by keyword" (Bright Data's docs listed `gd_lvz8ah06191smkebj4` on 14 Oct 2026),
  the allowed `date` and `sort_by` values, the record fields (including whether comments or other users'
  names come back, and whether output fields can be limited), the NSFW field, how long Bright Data keeps
  snapshots and whether they can be deleted after download, and the price per 1,000 records. Build the zod
  schema and synthetic fixtures from the documented shape. `scripts/capture-brightdata-fixture.ts` writes a
  real response to the git-ignored `fixtures-local/`; the founder runs it (it costs money), and the session
  checks the schema against it without committing it.
- Mapping: `post_id` to external id; `url` must be on `www.reddit.com` or `old.reddit.com` (normalized to
  `https://www.reddit.com/...`, never fetched); title plus description to the excerpt (280); `date_posted`
  to posted time; `community_name` to "r/<name>"; `user_posted` to the author key. Drop error records,
  NSFW, deleted authors, profile posts (community `u_<name>` or a URL under `/user/` or `/u/`), posts from
  sensitive communities (2.3.7) and every other field. Posts only in v1, not comments.
- Hosts: `api.brightdata.com`; link hosts `www.reddit.com`, `old.reddit.com`.
- Budget `REDDIT_DAILY_RECORDS_PER_PRODUCT` (default 120), global `BRIGHTDATA_MONTHLY_RECORD_CAP` (default
  20000), cost `BRIGHTDATA_COST_PER_1K` (default 1.50). The founder also sets a spend limit in Bright Data.
- If the API can limit output fields, the trigger asks only for the mapped fields; if it can delete a
  snapshot, the snapshot is deleted right after download. Tests assert both requests when the docs confirm
  the features.
- Retention 7 days. Deletion re-check (2.3.6): about 72 hours after collection, stored Reddit posts are
  re-collected by URL through the same pinned dataset, before new collection and outside the per-product
  budget (10 percent of the monthly cap is held for re-checks), and deleted here if gone, deleted or removed
  (`REDDIT_DELETION_RECHECK`, default `true`). About $1.35 per customer per month at default volumes.

### 7.8 Link sources

Unchanged hosts. Add per-subreddit search links from `products.subreddits`:
`https://www.reddit.com/r/<sub>/search/?q=<term>&restrict_sr=1&sort=new`.

---

## 8. AI

### 8.1 The wrapper (`src/server/llm/`)

- `createLlm({ client, usage, clock })` exposes `callStructured({ task, productId, model, system, input,
schema, jsonSchema, maxTokens })`. `system` is a list of blocks; blocks marked `cache` get
  `cache_control: { type: "ephemeral" }`.
- Structured output: use the API's JSON-schema output if the installed SDK supports it for the model;
  otherwise force a single tool whose `input_schema` is the JSON schema. Either way, validate with zod.
- One retry when validation fails. `stop_reason: "refusal"` raises `LlmRefusalError`; the batch is skipped
  and counted. Timeouts 60 seconds; the SDK retries 429 and 5xx twice.
- Every call writes `llm_usage` with tokens and cost from `PRICES`. Spend caps: per product per month
  (`LLM_MONTHLY_USD_CAP_PER_PRODUCT`, default 3) and global per day (`LLM_DAILY_USD_CAP`, default 25). A
  capped call is skipped and shown in `/admin`.
- Models: `claude-haiku-5-5` for classification and the preview, `claude-sonnet-5-5` for the onboarding
  draft and the weekly synthesis. Prices recorded 6 Oct 2026, per million tokens: Haiku 5.5 $0.10 input,
  $0.50 output; Sonnet 5.5 $2 input, $10 output. Re-check Anthropic's pricing page before M2 and update
  `PRICES` and section 18.
- No collected content is used to train any model.

### 8.2 Classification (Haiku, batches of 20)

System prompt (cached): what AskedFor does; the product profile; the product's name and aliases ("mentions
you"); competitors with keys and aliases; category and issue definitions, each with two short invented
examples; rules: never infer or mention sensitive traits; `tool_mentioned` is a product or company name,
never a person; `highlight` is an exact substring of the excerpt or empty; summaries paraphrase and never
quote; output only the schema. Pad the cached block with the definitions and examples so it exceeds the
model's minimum cacheable length. User message: a JSON array of `{ id, source, community, excerpt }`.

```ts
const Issue = z.enum([
  "pricing",
  "reliability",
  "missing_feature",
  "support",
  "usability",
  "performance",
  "integration",
  "other",
]);
const Classification = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        relevance: z.number().int().min(0).max(100),
        category: z.enum([
          "looking_for_tool",
          "pain_point",
          "mentions_you",
          "mentions_competitor",
          "wish",
          "not_relevant",
        ]),
        reason: z.string().max(160),
        highlight: z.string().max(140),
        tool_mentioned: z.string().max(60).nullable(),
        competitor_key: z.string().max(40).nullable(),
        rival: z
          .object({
            issue: Issue,
            sentiment: z.enum(["negative", "mixed", "positive"]),
            switching: z.boolean(),
            summary: z.string().max(200),
          })
          .nullable(),
      }),
    )
    .max(20),
});
```

After the call: drop ids we did not send; discard `not_relevant` and relevance below 40; turn `highlight`
into offsets by exact match in the excerpt (no match, no highlight); reject a `tool_mentioned` containing
`@`, `u/`, an email or a URL; accept `competitor_key` only if it is one of ours; keep `rival` only when a tool
or competitor is present.

Guard test: no property name in any model schema contains health, medical, religio, politic, sexual,
gender, race, ethnic, age, disab, pregnan, union, crime, nationality or immigration, and every system
prompt contains the never-infer rule.

### 8.3 Onboarding draft (Sonnet)

Input: the visible text of the user's page (title, meta description, headings, body; scripts, styles and
navigation removed; at most 30,000 characters) and the URL.

```ts
const Draft = z.object({
  name: z.string().min(1).max(120),
  one_liner: z.string().max(160),
  description: z.string().max(2000),
  audience: z.string().max(1000),
  competitors: z
    .array(z.object({ name: z.string().min(1).max(80), domain: z.string().max(253).nullable() }))
    .max(8),
  terms: z
    .array(
      z.object({
        term: z.string().min(2).max(60),
        intent: z.enum(["problem", "category", "alternative", "competitor"]),
      }),
    )
    .min(20)
    .max(30),
  subreddits: z.array(z.string().regex(/^[A-Za-z0-9_]{2,21}$/)).max(10),
});
```

Terms are phrases people actually write ("looking for a tool to", "how do I", "alternative to <rival>"),
not marketing keywords, with 3 to 6 "alternative to" terms when competitors exist. Suggested subreddits are
filtered through the sensitive-community list (2.3.7) after the model answers.

### 8.4 Weekly synthesis (Sonnet)

One call for Build and one for Rivals per product, on this week's stored relevant posts (`{ id, category,
excerpt, rival labels }`) plus last week's theme keys and counts.

```ts
const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
const BuildSynthesis = z.object({
  themes: z
    .array(
      z.object({
        theme_key: Slug,
        kind: z.enum(["ask", "wish", "pain"]),
        title: z.string().max(120),
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(8),
  opportunities: z
    .array(
      z.object({
        theme_key: Slug,
        title: z.string().max(120),
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(3),
});
const RivalSynthesis = z.object({
  rivals: z
    .array(
      z.object({
        competitor_key: z.string().nullable(),
        tool_name: z.string().max(60).nullable(),
        issue: Issue,
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(24),
  fixes: z
    .array(
      z.object({
        theme_key: Slug,
        title: z.string().max(120),
        summary: z.string().max(600),
        post_ids: z.array(z.string()).min(1),
      }),
    )
    .max(3),
});
```

Counts come from our labels, not from the model: rival complaints are posts with that rival and issue and a
negative or mixed sentiment; switching counts `switching = true`; a theme's count is its number of valid
post ids. Trend against last week's row with the same key: `new` if none, `up` at 20 percent or more,
`down` at 20 percent or less, otherwise `flat`. Before saving: drop post ids we did not send; reject any
summary that shares 8 or more consecutive words with an input excerpt (regenerate once, then drop the
item); reject handles (`@name`, `u/name`). Opportunities save as themes of kind `opportunity`, fixes as kind
`rival_fix`, with the first 3 valid post ids as examples.

### 8.5 Preview (Haiku)

A lighter draft (name, one-liner, 8 terms), Hacker News and Bluesky only, last 7 days, classified with the
schema above, top 5 kept, plus one starter theme (`{ title, summary }`, same quote and handle checks). No
Reddit or X in the preview: they cost money per record. The URL must not be a platform host (2.1.10).
Results pass the same filters as ingest before they are shown or stored: relevance 40 or more, suppressed
authors dropped by hash, NSFW dropped, excerpts at most 280 characters, and `preview_runs.result` validated with a zod schema that has
no author fields (url, source, community, excerpt, category, reason, highlight offsets).

### 8.6 Evaluation

`npm run eval:classifier` reads `eval/labeled.jsonl` (100 posts the founder labels: relevant or not, and
category) and prints precision and recall at the default threshold. Target precision 0.8 or better. It calls
the live API, so it runs by hand, never in CI. Replace section 18's model estimates with measured numbers.

---

## 9. UI and visual system

### 9.1 Keep the format

The site keeps its current format: warm paper background, near-black ink, one deep ink-blue accent, a serif
wordmark and headings, a single centered column for marketing pages (`max-w-3xl`), thin rules, the footer of
legal links, a real dark mode. The app uses the same tokens and type in a wider frame (`max-w-5xl`).

### 9.2 Tokens

Keep the existing tokens in `src/app/globals.css`. Add `--highlight` (light `#f3dd6d`, dark `#6b5a12`, ink
text on both), `--positive` and `--negative` for trends (always paired with an arrow and text, never color
alone). A unit test computes WCAG 2.2 contrast from the token values: at least 4.5:1 for text pairs in both
themes.

### 9.3 Type

Fraunces (variable, from `@fontsource-variable/fraunces`) for the wordmark and headings; Geist Sans (from
`geist`) for UI; tabular numbers for counts. Self-hosted; no request to a font CDN.

### 9.4 Components

Cards with a 1px rule border, 2px corners and no shadows; square-ish chips; buttons in three weights
(primary on the accent, secondary with a rule border, quiet text); the existing focus outline; the
highlighter as a `<mark>` with the highlight token and no animation; a tiny inline SVG sparkline. Build
them in `src/components/ui/` with render tests (`renderToStaticMarkup`).

### 9.5 App frame

Top bar: wordmark, product name, tabs (Reply, Rivals, Build), Settings, account menu. At 375px the tabs move
to a bottom bar and filters collapse into a sheet. Everything works by keyboard with a visible focus.

### 9.6 Landing page

Structure from the brief, with D2 and D12 applied. Copy below is the starting point; every claim and number
gets a row in `docs/claims.md` before it ships.

1. **Hero.** "Who to reply to today. What your rivals get wrong. What to build next." Subhead: "AskedFor
   reads public conversations about the problem you solve, then shows you the people worth replying to,
   where your rivals fall short, and what people keep asking for." Buttons: "Try it on your product"
   (instant preview, inline) and "Start 7-day trial". One line under them: the full price and renewal terms.
2. **The three tabs** side by side (stacked on mobile), each with labeled "Example" data. Example cards show
   no handles, like the product.
3. **How it works**, one left-to-right strip: paste your URL; we collect public posts that match; you reply
   in your own words and see what your rivals miss.
4. **Where your posts come from** (prominent): "Hacker News and Bluesky through their official APIs. Reddit
   through a web data company that collects public Reddit pages for us (named on our sources page). X
   through its official API when it is switched on. LinkedIn, Facebook and Threads as one-tap searches you
   open yourself. We never post, reply or message for you, and we never write your replies. Raw posts are
   deleted from AskedFor after 30 days, or 7 days for Reddit and X." Link to `/sources`. The sources page
   and the privacy notice name Bright Data, say it collects public Reddit pages, say this is not a data
   license from Reddit, and state how long Bright Data keeps snapshots. The solicitor reviews the wording.
5. **Pricing**: one plan, the full monthly price with tax included where it applies (no drip pricing),
   7-day trial, card required, the reminder before the first charge, cancel in two clicks in Settings.
6. **FAQ**: Does it post for me? Does it write replies for me? Where does Reddit data come from? What do you
   store and for how long? You show a post I wrote; how do I remove it? Can I cancel any time?
7. **Footer**: contact email, trading name and address, privacy notice, Remove my post, terms, acceptable
   use, cookies, sources.

No testimonials, user counts or badges until real ones exist with written permission. No competitor named.

### 9.7 Accessibility and performance

WCAG 2.2 AA, keyboard navigable, `aria-live` for async states, reduced motion respected, works at 375px.
Marketing pages static; app pages server-rendered; 200 cards in under 1.5 seconds.

---

## 10. Billing completion

The plumbing exists and is tested (section 3.1). What remains:

1. **`/app/billing`** shows, before checkout: the full price (read from Stripe), tax included where it
   applies (configure the Stripe price as tax-inclusive if Managed Payments supports it; otherwise show the
   tax-inclusive total for the visitor's country before checkout), the renewal terms
   (`renewalTerms()`), when the first charge happens, the reminder 48 hours before it, how to cancel, and the
   consent checkbox for starting the service during the cancellation period. Checkout requires the box.
2. **Consent record:** the checkout handler requires `{ consent: true }`, puts the time in the
   subscription's metadata, and the webhook writes `profiles.service_consent_at`. The consent wording is a
   constant marked for solicitor review (`(you)` box).
3. **Settings, Plan and billing:** status in plain words, Cancel (two clicks: the first opens an inline
   confirm with the access-until date, the second calls `POST /api/billing/cancel`), Resume, Update card
   (`POST /api/billing/portal`), a banner for `past_due`.
4. **Entitlement** checked on every app data page and before any collection, after the welcome step has
   confirmed a just-completed Checkout Session (7.3).
5. **Reminder amount:** the trial reminder states the full amount the customer will be charged, tax included
   where it applies (from Stripe's invoice preview for the subscription when the price is not
   tax-inclusive).
6. **Account deletion:** typed confirmation; cancel the Stripe subscription immediately (add `cancelNow`
   to the Stripe port and adapter); delete the auth user with the admin API (cascades every owned row); record
   `account_deleted` in `events` with no user id and in `audit_log`; orphaned posts go at the next purge.
7. **Export:** JSON of everything the user owns (feed items as links, sources, communities, ages, labels
   and reasons, never excerpts, 2.3.14), plus Markdown for Build and Rivals.
8. **Hourly reminders** once Vercel Pro is on (section 13). Live billing refuses to start until they are.
9. **E2E in test mode** without driving Stripe's hosted page (Playwright stays on localhost): assert the
   checkout redirect and its parameters, then complete the subscription with the Stripe API in test mode and
   post a correctly signed event to the local webhook. The founder clicks through real test-mode Checkout
   once (F14).
10. **Live switch** stays with the founder (`docs/BILLING.md`).

---

## 11. Email

All email goes through Resend from `EMAIL_FROM`: plain HTML and text, US English, no em dashes, no images,
no tracking pixels. Daily and weekly emails carry `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

| Email                     | Trigger                       | Notes                                                                                                                |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Magic link                | Supabase Auth via Resend SMTP | Template wording set in the Supabase dashboard (F5)                                                                  |
| Trial reminder            | exists                        | at least 48 hours before the first charge                                                                            |
| First feed ready          | end of `first_run`            | counts by category, link to the app                                                                                  |
| New posts (daily)         | `digest_daily`                | top 5 by match score: source, community, age, reason and a link to the app card, never excerpts; "Say you built it." |
| Monday digest             | `digest_weekly`               | top themes, rival changes, what to build next; "Say you built it." where it links to posts                           |
| Removal received and done | removal form, admin action    | to the requester's contact email                                                                                     |

Unsubscribe tokens are `HMAC(APP_HMAC_SECRET, user id, list)`. `GET /api/unsubscribe` shows a confirm page;
`POST` applies it. No marketing email in v1.

---

## 12. Security, privacy and compliance controls

### 12.1 Auth

Supabase Auth with PKCE through `@supabase/ssr`. `src/proxy.ts` refreshes the session and protects `/app`
and `/admin`, excluding `/api/billing/webhook`, `/api/cron/*`, `/api/health` and static files. The `next`
parameter must be a relative path starting with one `/` (test: `//evil.example`, `https://evil.example` and
`/\evil.example` all fall back to `/app`).

### 12.2 CSRF

Server actions rely on Next's origin check. Cookie-authenticated route handlers use `isSameOrigin`.

### 12.3 `fetchOwnSite()` (`src/server/net/own-site.ts`)

The only other file allowed to open connections. It uses `node:https` with a custom `lookup` that resolves
the host and refuses loopback, private, link-local, CGNAT, multicast, reserved, IPv6 unique-local and
link-local, and IPv4-mapped forms of them, on every connection including redirects (no DNS-rebinding gap).
https and port 443 only, at most 3 redirects within the same host or its `www` twin, 10 second timeout,
2 MB body cap, `text/html` or `text/plain` only, no cookies or credentials. It refuses any host for which
`isPlatformHost()` in `src/server/net/platform-hosts.ts` is true (2.1.10): every platform domain and all its
subdomains, API hosts included, because a user's product site is never one of them. The list covers at
least `reddit.com`, `redd.it`, `redditmedia.com`, `x.com`, `twitter.com`, `t.co`, `linkedin.com`, `lnkd.in`,
`facebook.com`, `fb.com`, `fb.me`, `instagram.com`, `threads.net`, `threads.com`, `tiktok.com`,
`youtube.com`, `youtu.be`, `discord.com`, `discord.gg`, `bsky.app`, `bsky.social`, `ycombinator.com`,
`hn.algolia.com`, `hacker-news.firebaseio.com`, `producthunt.com`, `indiehackers.com`, the vendor's host,
and the proxies and caches that would reach a platform page indirectly: `translate.goog`,
`web.archive.org`, `archive.org`, `archive.ph`, `archive.today`, `webcache.googleusercontent.com`. It
checks the first URL and every redirect, and the user is asked to paste a description instead. The hosts
test reuses the module's list of platform web hosts. The hosts gate is extended to
allow `node:https` and `node:dns` in this file only, with a planted-violation test that the same imports
anywhere else still fail.

### 12.4 Processors (D11)

| Processor   | Purpose                           | Where                                     | Transfer note to record                               |
| ----------- | --------------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| Supabase    | database, auth                    | London (`eu-west-2`)                      | UK hosting; DPA                                       |
| Vercel      | hosting, functions                | functions in London (`lhr1`); edge global | DPA; transfer terms                                   |
| Anthropic   | classification, drafts, synthesis | US                                        | DPA in commercial terms; UK transfer mechanism        |
| Resend      | email                             | US                                        | DPA; UK transfer mechanism                            |
| Stripe      | payments, merchant of record      | US and EU                                 | DPA; Stripe is controller for its MoR role            |
| Bright Data | Reddit data collection            | Israel and its infrastructure             | Israel has UK adequacy; confirm where processing runs |

X is a data source, not a processor. Add each to the privacy notice and `docs/legal/processors.md` with the
DPA link and the transfer mechanism before turning it on in production.

### 12.5 Hashing

Author hash: `HMAC-SHA256(AUTHOR_HASH_PEPPER, "<source>:<normalized author key>")`, hex. Normalize by
trimming, lowercasing and removing a leading `@` or `u/`. The pepper never rotates (rotating it would orphan
the suppression list). The removal form hashes a Reddit or Hacker News username the same way, and resolves a
Bluesky handle or an X username to its stable id first (4.8). IP hashes for
rate limits: `HMAC(APP_HMAC_SECRET, "<UTC day>:<ip>")`, so they change daily.

### 12.6 Analytics

Only the `events` table, written server-side, with no cookies, IPs or user agents. `/admin` computes
activation, weekly active users, replies per user per week and trial-to-paid from it.

### 12.7 Rate limits

Preview: 3 per IP hash per day and `PREVIEW_DAILY_CAP` overall. Removal form: 5 per IP hash per day. Sign-in:
Supabase's own limits.

### 12.8 Headers

In `next.config.ts`: `frame-ancestors 'none'` (or `X-Frame-Options: DENY`), `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, a minimal `Permissions-Policy`, and
`Strict-Transport-Security`. Add a nonce-based CSP only if marketing pages stay within the performance budget
(follow `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).

### 12.9 Legal drafts (for the solicitor)

The session drafts these; the founder takes them to a UK solicitor or compliance service (F15):
`/privacy` (users, plus the Article 14 notice for post authors: what, from where including the data provider,
why, lawful basis, retention by source, rights, how to object, the removal form, the ICO), `/terms`
(subscription, trial, renewal, cancellation, refunds and cooling-off, consent, 18+), `/acceptable-use`,
`/cookies` (essential only, listed), `/sources`, and internal `docs/legal/` files: `lia.md`, `dpia.md`
(including vendor collection, the Reddit deletion gap, DIDs in Bluesky links, the sensitive-community
filter, and the Article 9(2)(e) condition for health and similar details people disclose in their own public
posts), `ropa.md`, `processors.md`, `breach-plan.md`.

### 12.10 Pre-launch access

Until the founder says launch, sign-in is limited to the emails in `SIGNUP_ALLOWLIST` (comma-separated):
anyone else sees "AskedFor is in private beta" and no account is created. Collection runs only for allowed
accounts. This keeps test-mode Checkout and vendor spend away from strangers while milestones merge to
production. The launch switch (M9) removes the allowlist check.

---

## 13. Scheduling

| Route                       | Now (Hobby)  | After Vercel Pro (F2) | Does                                                                                            |
| --------------------------- | ------------ | --------------------- | ----------------------------------------------------------------------------------------------- |
| `/api/cron/trial-reminders` | `0 7 * * *`  | `0 * * * *`           | DMCC reminder                                                                                   |
| `/api/cron/daily`           | `0 6 * * *`  | `0 6 * * *`           | enqueue collect, deletion sync, purge, digests; on Hobby also runs the job loop for up to 240 s |
| `/api/cron/tick`            | not declared | `*/10 * * * *`        | advance jobs                                                                                    |
| `/api/cron/weekly`          | `0 21 * * 0` | `0 21 * * 0`          | enqueue synthesis                                                                               |

Every cron route is a `GET` that checks `CRON_SECRET` with `isCronAuthorized`, sets `maxDuration` (300 for the
job routes; `trial-reminders` needs 60), is
idempotent, and returns non-2xx on failure. `tests/deploy/vercel-config.test.ts` enforces Hobby-safe
schedules today and ties the reminder schedule to `REMINDER_CRON_PERIOD_HOURS`. The M3 task that switches to
the Pro schedule changes the schedule, that constant and the test in the same commit, and only
after the founder confirms Pro (or `get_auth_user` on the Vercel connector shows `billing.plan` is `pro`).

---

## 14. Environment variables

"Vercel" means Project Settings, Environment Variables, for Production and Preview. "Session" means the
Claude Code cloud environment for the build session (F12), so tests that need a real service can run there.
"dev" means the value for the development Supabase project: the production Supabase secret key never goes
into the session, and Stripe stays in test mode. Never commit values; `.env.local` is for local work and is
git-ignored.

| Variable                                     | Value                                                                                                 | Vercel   | Session                 | Used from |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------- | ----------------------- | --------- |
| `NEXT_PUBLIC_SITE_URL`                       | production URL, `https://...` (no trailing slash)                                                     | yes      | `http://localhost:3000` | now       |
| `NEXT_PUBLIC_SUPABASE_URL`                   | `https://hoqbflkszzoojdswbrgy.supabase.co`                                                            | yes      | dev                     | now       |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`       | `sb_publishable_...`                                                                                  | yes      | dev                     | now       |
| `SUPABASE_SECRET_KEY`                        | `sb_secret_...` (server only)                                                                         | yes      | dev                     | now       |
| `STRIPE_SECRET_KEY`                          | `sk_test_...` until the live switch                                                                   | yes      | yes                     | now       |
| `STRIPE_WEBHOOK_SECRET`                      | `whsec_...` from the endpoint (F11)                                                                   | yes      | yes                     | now       |
| `STRIPE_PRICE_ID`                            | `price_...`                                                                                           | yes      | yes                     | now       |
| `STRIPE_MANAGED_PAYMENTS`                    | `true`                                                                                                | yes      | yes                     | now       |
| `BILLING_LIVE_ENABLED`                       | `false` (founder only)                                                                                | yes      | no                      | now       |
| `RESEND_API_KEY`                             | `re_...`                                                                                              | yes      | optional                | now       |
| `EMAIL_FROM`                                 | `AskedFor <hello@your-domain>`                                                                        | yes      | optional                | now       |
| `CRON_SECRET`                                | 32 or more random characters                                                                          | yes      | yes                     | now       |
| `ANTHROPIC_API_KEY`                          | from the Anthropic Console                                                                            | yes      | yes                     | M2        |
| `AUTHOR_HASH_PEPPER`                         | 32 or more random characters; never rotate                                                            | yes      | dev                     | M3        |
| `APP_HMAC_SECRET`                            | 32 or more random characters                                                                          | yes      | dev                     | M3        |
| `SOURCE_HACKERNEWS_ENABLED`                  | `true` when M3 ships                                                                                  | yes      | no                      | M3        |
| `SOURCE_BLUESKY_ENABLED`                     | `true` after F7                                                                                       | yes      | no                      | M3        |
| `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` | the AskedFor account and its app password                                                             | yes      | optional                | M3        |
| `SOURCE_REDDIT_ENABLED`                      | `true` after F8 and the DPA                                                                           | yes      | no                      | M3        |
| `REDDIT_PROVIDER`                            | `brightdata`                                                                                          | yes      | no                      | M3        |
| `BRIGHTDATA_API_TOKEN`                       | from Bright Data                                                                                      | yes      | no                      | M3        |
| `BRIGHTDATA_REDDIT_DATASET_ID`               | `gd_...` (confirm in the dashboard)                                                                   | yes      | no                      | M3        |
| `BRIGHTDATA_COST_PER_1K`                     | `1.50` (your actual rate)                                                                             | yes      | no                      | M3        |
| `BRIGHTDATA_MONTHLY_RECORD_CAP`              | `20000`                                                                                               | yes      | no                      | M3        |
| `BRIGHTDATA_DPA_SIGNED_ON`                   | the date the DPA, transfer mechanism and DPIA were done (2.1.7); production refuses Reddit without it | yes      | no                      | M3        |
| `REDDIT_DAILY_RECORDS_PER_PRODUCT`           | `120`                                                                                                 | yes      | no                      | M3        |
| `REDDIT_DELETION_RECHECK`                    | `true`                                                                                                | yes      | no                      | M3        |
| `SOURCE_X_ENABLED`                           | `false`                                                                                               | yes      | no                      | M3        |
| `X_BEARER_TOKEN`                             | only if you turn X on (F18)                                                                           | optional | no                      | M3        |
| `X_DAILY_READS_PER_PRODUCT`                  | `0`                                                                                                   | yes      | no                      | M3        |
| `LLM_MONTHLY_USD_CAP_PER_PRODUCT`            | `3`                                                                                                   | yes      | no                      | M4        |
| `LLM_DAILY_USD_CAP`                          | `25`                                                                                                  | yes      | no                      | M4        |
| `PREVIEW_DAILY_CAP`                          | `200`                                                                                                 | yes      | no                      | M9        |
| `SIGNUP_ALLOWLIST`                           | comma-separated emails allowed to sign in before launch (12.10)                                       | yes      | dev                     | M1        |

Link-source kill switches (`SOURCE_REDDIT_LINKS_ENABLED`, `SOURCE_X_LINKS_ENABLED` and the rest) default on
and need no value. `.env.example` lists every variable above with a placeholder.

---

## 15. Founder actions

In order. Each says when it is needed. Steps you skip do not stop the build (section 0), only the live
checks that depend on them.

- **F1. Reconnect the Vercel connector** (now, 5 min). In claude.ai, Settings, Connectors, Vercel: reconnect and grant access to your "buzz542's projects" scope. Today the connector can list projects but is refused for that scope, so Claude cannot see deployments or logs.
- **F2. Upgrade Vercel to Pro** (before M3; required before launch). Your account shows a Pro trial is available. Hobby is for non-commercial use only and refuses crons that run more than once a day. Then tell Claude "Vercel Pro is on".
- **F3. Import the repo into Vercel** (before M1, 15 min). Add New, Project, import `buzz542/feedyourbusiness`, name it `askedfor`, framework Next.js, deploy. Then Settings, Git: set the Production Branch to `claude/askedfor-foundations`. Then add the "Vercel" variables from section 14 that you have, and redeploy. Functions run in London (`lhr1`) because of `vercel.json`. Do not set `SOURCE_REDDIT_ENABLED` before F8: it now switches on paid Reddit collection (the Reddit search links are `SOURCE_REDDIT_LINKS_ENABLED`).
- **F4. Create the Supabase secret key** (before M1, 5 min). Project `askedfor`, Project Settings, API Keys, Secret keys: create one named `vercel`. Put it in Vercel only, as `SUPABASE_SECRET_KEY`. The build session and `.env.local` use the development project's key (F12).
- **F5. Set up Supabase Auth** (before M1, 20 min). URL Configuration: Site URL is your production URL; Redirect URLs are `<production>/auth/callback`, `http://localhost:3000/auth/callback` and `https://*-buzz542s-projects.vercel.app/auth/callback`. Google provider: create a Web OAuth client in Google Cloud with the redirect URI `https://hoqbflkszzoojdswbrgy.supabase.co/auth/v1/callback`, and paste its id and secret. After F6, SMTP: host `smtp.resend.com`, port 465, user `resend`, password a Resend API key, sender your `EMAIL_FROM`. Magic link subject: "Your AskedFor sign-in link". In Authentication, Email Templates, set the link in both the Magic link and the Confirm signup templates to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`, so a link opened on another device or browser still signs in (the default PKCE link only works in the browser that asked for it). Before launch, also add a "Before User Created" auth hook that rejects emails not on the allowlist, or turn off new signups and pre-create the allowlisted users: Supabase's own signup endpoint is public, so the app's allowlist check alone cannot stop an account being created (the app does sign such a session out and refuses it checkout).
- **F6. Set up Resend** (before M5). Add and verify your sending domain (needs F10), create a sending API key, set `RESEND_API_KEY` and `EMAIL_FROM`.
- **F7. Create the AskedFor Bluesky account** (before M3). Put a monitored contact email in its bio, create an app password, set `BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD`, then `SOURCE_BLUESKY_ENABLED=true`.
- **F8. Set up Bright Data** (before M3, for Reddit). Business account, their compliance review, accept their DPA and keep a copy, ask how long they keep snapshots and whether output fields can be limited, add funds, set a spend limit and alerts, create an API token, confirm the Reddit posts dataset id. Set the `BRIGHTDATA_*` variables in Vercel only. In Bright Data, create no Web Unlocker, SERP or Scraping Browser products, restrict the token to the Web Scraper API if they allow it, and get written confirmation that the Reddit dataset collects only logged-out public pages. Run `scripts/capture-brightdata-fixture.ts` once on your machine: it checks a real response against the schema locally, prints pass or fail and the field names, and deletes the capture. Then set `BRIGHTDATA_DPA_SIGNED_ON` to that date and `SOURCE_REDDIT_ENABLED=true`, only when 2.1.7 holds: DPA signed, transfer mechanism recorded, DPIA covering the vendor signed, and Bright Data named in the privacy notice and on the sources page.
- **F9. Ask Reddit for licensed access** (now, before 31 Oct 2026). Request commercial Data API access through Reddit's developer platform and describe this use honestly: read-only, excerpts with links back, 7-day retention, no model training. Reddit stops taking new public API access requests on 31 Oct 2026. Keep the reply.
- **F10. Trademark search, then the domain** (before M5, because Resend needs the domain for F6). Search "AskedFor" at the UK IPO, EUIPO and USPTO (classes 9, 35, 42). Then buy `askedfor.app` (and `askedfor.dev` as a redirect), add it in Vercel, Domains, and set `NEXT_PUBLIC_SITE_URL` to the primary domain, the one that does not redirect (Stripe's webhook and every email link use it).
- **F11. Set up Stripe in test mode** (before M8). Follow `docs/BILLING.md` steps 1 to 6: authorize the Stripe connector or use the Dashboard, confirm Managed Payments eligibility, create the product and the $29 monthly price (tax-inclusive if Managed Payments allows it, so the price shown is the price paid), enable the customer portal for card updates, add the webhook endpoint `<production>/api/billing/webhook` with the four events, set the `STRIPE_*` variables. Check with section 16.
- **F12. Configure the Claude Code environment** (before M1, 15 min). First create a free Supabase project for development (for example `askedfor-dev`; or reuse the old `buzz542's Project` in `eu-west-1` if it holds nothing you need). Then, in the cloud environment menu in the session's title bar, Edit: add the "Session" variables from section 14 as environment variables, never in the chat, using the development project's Supabase URL and keys (never the production secret key) and Stripe test keys. Network access: allow `api.stripe.com` and your development project's `*.supabase.co` host, and keep package managers allowed. Add `api.anthropic.com` only if you want the session to run model checks with your key while you watch. The session never needs the sources' hosts: its tests use synthetic fixtures.
- **F13. Create the Anthropic API key** (before M2). In the Anthropic Console, create a key for AskedFor, set a monthly spend limit, and set `ANTHROPIC_API_KEY` in Vercel and the session.
- **F14. Click through test mode yourself** (M8). In a browser: sign up, onboard, pay with a Stripe test card in Checkout, see the trial in Settings, cancel in two clicks, resume, delete a test account.
- **F15. Legal** (before taking money). Solicitor review of the drafts in 12.9, ICO fee paid, LIA and DPIA signed off, DPAs signed with every processor in 12.4, trading name, address and email in the footer, HMRC registration if needed.
- **F16. Label 100 posts** (M4). Label the posts in `eval/labeled.jsonl` for the classifier eval; the session prepares the file from your own feed.
- **F17. Supabase Pro** (before real users). Backups and no pausing, for the production project. Pause or delete the old `buzz542's Project` in `eu-west-1` if you did not reuse it for development in F12.
- **F18. X, optional.** A developer account with pay-per-use credits, an app bearer token and the use case declared honestly. Then set `X_BEARER_TOKEN`, a budget in `X_DAILY_READS_PER_PRODUCT`, and `SOURCE_X_ENABLED=true`.

---

## 16. Verify a deployment

After F3, F4 and F11, run these from any terminal (replace the URL and secret):

```sh
curl https://YOUR-DEPLOYMENT/api/health
# {"status":"up"}

curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-DEPLOYMENT/api/health
# 200 with every check "ok", or 503 naming what is missing
# 401 means the secret did not match, or CRON_SECRET on the server is unset or under 16 characters
```

| Check            | Not ok means                                                                                                                                                                                                        | Fix                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `site_url`       | `NEXT_PUBLIC_SITE_URL` missing, or not this deployment's https URL                                                                                                                                                  | set it in Vercel, redeploy                                                                           |
| `supabase`       | a key is missing, the URL is another project, or the query failed (error class shown)                                                                                                                               | F4; check the URL; check migrations ran                                                              |
| `stripe_config`  | Stripe variables missing or malformed, or a live key while live billing is locked                                                                                                                                   | F11                                                                                                  |
| `stripe_price`   | the price is missing, inactive or not recurring                                                                                                                                                                     | F11 step 3                                                                                           |
| `stripe_webhook` | no endpoint at `<site>/api/billing/webhook`, a near miss that redirects (trailing slash, `http://`, the other `www` form), disabled, duplicated, missing events, or billing events undelivered in the last 24 hours | F11 step 5; register exactly the URL shown; check `STRIPE_WEBHOOK_SECRET`, then resend failed events |
| `email`          | Resend variables missing, or `EMAIL_FROM` still a placeholder                                                                                                                                                       | F6                                                                                                   |
| `cron_secret`    | `CRON_SECRET` shorter than 32 characters, or still the `.env.example` placeholder                                                                                                                                   | set a long random value, redeploy                                                                    |

`NEXT_PUBLIC_SITE_URL` must be the primary domain, the one that does not redirect: if the apex redirects to
`www` (or the reverse), Stripe's deliveries to the redirecting one fail.

Use the production URL: Vercel protects preview deployments with Vercel Authentication by default, so a
`curl` to a preview URL gets Vercel's login page instead of the app (and Stripe cannot reach a preview's
webhook either).

Then: Vercel, Settings, Cron Jobs lists the crons; run `trial-reminders` once and see a 200 in the logs. In
Stripe, send a test `customer.subscription.updated` event to the endpoint and see it answered.

---

## 17. Milestones

The tasks, acceptance tests and `/goal` lines are in `docs/TASKS.md`.

| Milestone      | Ships                                                                                                               | Founder gates       |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------- |
| M0 Foundations | done: repo, Supabase, CI, gates, billing plumbing, deploy config, health check                                      | F1, F3, F4, F5, F17 |
| M1 App shell   | auth, proxy, app frame, design system, copy gate for app UI, `profiles_app` migration, E2E harness                  | F12 (for E2E)       |
| M2 Onboarding  | `fetchOwnSite`, LLM wrapper, draft, review and confirm, competitors                                                 | F13                 |
| M3 Collection  | contract v2, jobs, budgets, ingest, HN, Bluesky, Reddit via the vendor, X (off), purge, deletion sync, Pro schedule | F2, F7, F8          |
| M4 Classifier  | labels incl. rivals, highlight, dedupe, caps, eval                                                                  | F16                 |
| M5 Reply tab   | views, filters, cards, actions, tips, search links, keyboard, daily email, first run                                | F10, F6             |
| M6 Rivals tab  | scorecards, issues, switchers, fixes, discovered tools, export                                                      | none                |
| M7 Build tab   | themes, wishes, what to build next, export, Monday digest                                                           | none                |
| M8 Billing     | billing page, consent, settings, entitlement, deletion, export, hourly reminders                                    | F11, F14            |
| M9 Launch      | landing, preview, sources page, removal flow, admin, legal drafts, launch switch                                    | F15                 |

---

## 18. Costs (estimates, replace with measured numbers in M4)

Per customer per month at default budgets:

| Item                          | Assumption                                                                          | Cost            |
| ----------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| Reddit via Bright Data        | 120 records a day, $1.50 per 1,000 records (pay as you go; confirm your rate)       | about $5.40     |
| Reddit deletion re-check      | the roughly 30 stored Reddit posts a day re-collected once by URL at about 72 hours | about $1.35     |
| Classification (Haiku 5.5)    | about 320 candidates a day in batches of 20, cached system prompt                   | about $0.55     |
| Weekly synthesis (Sonnet 5.5) | 2 calls a week, about 20,000 input and 2,000 output tokens each                     | about $0.55     |
| Onboarding draft (Sonnet 5.5) | once                                                                                | about $0.03     |
| Hacker News, Bluesky          | free official APIs                                                                  | $0              |
| X                             | off by default; $0.005 per post read when on                                        | $0              |
| **Total variable**            |                                                                                     | **about $7.85** |

Fixed per month: Vercel Pro $20 per seat, Supabase Pro $25, Resend free tier then $20, the domain. Merchant
of record fees: check Managed Payments' current rate. At $29 a month the variable margin is about $21 before
those fees ($29 minus about $7.85), so fixed costs are covered at roughly 3 paying customers. The Reddit
budget is the lever: halving it saves about $3.40 per customer, re-checks included.

---

## 19. Risks

| Risk                                                        | Mitigation                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reddit objects to vendor-collected data (letter or lawsuit) | Kill switch in minutes; excerpts only with links back; 7-day retention; no republishing; low volume; licensed request in parallel (F9); provider port to swap in a licensed feed; DPIA records the decision |
| Vendor quality or latency                                   | Budgets and caps; first run streams HN and Bluesky while Reddit finishes; health in `/admin`; provider port                                                                                                 |
| Thin or noisy feed                                          | Terms written like real posts; rotation; threshold control; eval at 0.8 precision; per-term stats so users prune                                                                                            |
| Cost overrun                                                | Per-product daily budgets, vendor monthly cap, model spend caps, vendor-side spend limit, `/admin` costs                                                                                                    |
| Personal data complaints                                    | Minimal fields, no handles, removal in one click, suppression, retention, Article 14 notice, DPIA                                                                                                           |
| Vercel plan limits                                          | Hobby-safe config until F2; Pro required before launch                                                                                                                                                      |
| Subscription law (DMCC from January 2027)                   | Terms before checkout, reminder, two-click cancel, consent record, solicitor review                                                                                                                         |
| X costs                                                     | Off by default; budget 0 unless the founder sets one                                                                                                                                                        |

---

## 20. References (checked 14 Oct 2026)

- Vercel: Hobby is for non-commercial use (fair use guidelines); Hobby crons run at most once a day and a
  more frequent expression fails the deployment (cron usage and pricing); Hobby functions may use any single
  region; Node version from `engines.node`; function duration limits (300 s default and maximum on Hobby,
  up to 800 s on Pro with fluid compute).
- Next.js 16: `middleware` renamed to `proxy` (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`).
- Bright Data Reddit scraper docs: posts dataset, discover by keyword (`keyword`, `date`, `num_of_posts`),
  async trigger, progress and snapshot endpoints.
- X API pay-per-use (February 2026): about $0.005 per post read; confirm in the developer console.
- Bluesky: unauthenticated `searchPosts` returning 403 reported since 2025; use an authenticated account.
- Everything the brief cites (Reddit's API timeline and lawsuits, DMCC, ICO, Managed Payments) still applies;
  see `docs/BRIEF.md`, "Sources".

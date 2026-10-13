# AskedFor: Build Brief for Claude Code

2026-10-13 · @Toby

## How to use this brief

Put this brief in an empty repo, paste the kickoff prompt into Claude Code, and approve the PRD it writes before any product code exists.

1. Export this doc as Markdown and save it as `docs/BRIEF.md` in a new GitHub repo.
2. Open Claude Code in that repo (terminal, desktop app, or Claude Code on the web).
3. Paste the kickoff prompt from the next section. Claude Code writes `docs/PRD.md`, `CLAUDE.md`, `docs/TASKS.md`, two review subagents and the hooks, then stops.
4. Read those files. This is your biggest decision point: anything wrong here gets built.
5. Approve, then run one `/goal` per milestone. Check in at the human checkpoints in the Quality loop section.

Two rules for you, the founder:

- **Hard compliance rules are non-negotiable.** To change one, edit this brief on purpose, never mid-chat with Claude Code.
- **This is not legal advice.** Get the pre-launch checklist in the last section reviewed by a UK solicitor or compliance service before you take money.

## Kickoff prompt for Claude Code

Paste this as your first message. It makes Claude Code plan before it builds, then stop for your approval.

```text
Read docs/BRIEF.md in full. It is the source of truth for this project.

Phase 0, setup only (no product code yet):
1. Write docs/PRD.md: a concise PRD, about two pages, derived from the brief. Include problem, users, the two jobs (Reply, Build), MVP scope, out of scope, success metrics and acceptance criteria per feature. Copy the "Hard compliance rules" section into the PRD unchanged.
2. Write CLAUDE.md from the "CLAUDE.md contents" section. Keep it under 200 lines. Put path-specific rules in .claude/rules/ as described there.
3. Write docs/TASKS.md: milestones M0 to M7 from the brief, each split into tasks with a checkbox and an acceptance test.
4. Write docs/claims.md: an empty register where every public marketing claim must be listed with its evidence.
5. Create the two subagents, the hooks and the CI gates described in the "Quality loop" section.
6. List every contradiction, gap or risky assumption you found in the brief, with your proposed fix. Then STOP and wait for my approval.

Standing rules from now on: never call a host that is not on the data source allowlist; never write fake testimonials, reviews, user counts, logos or upvote requests; ask me before changing anything about data sources, stored data, privacy, billing or marketing claims.
```

Then, for each milestone after you approve Phase 0:

```text
/goal Milestone M1 in docs/TASKS.md is complete: every M1 box is ticked, `npm run check` exits 0, the compliance-reviewer subagent reports no blocking findings, and no file outside M1's scope changed. Or stop after 30 turns and list what is left.
```

Run goals in auto mode so turns don't pause on every permission prompt. Switch back to manual mode for anything touching billing, production secrets or the live database.

## Product

**AskedFor shows indie makers who to reply to today and what to build next, using only sources it is allowed to use.**

- **Name:** AskedFor. The double meaning is the pitch: people who asked for what you built, and what they ask for next. FYB stays as the internal codename.
- **Domains:** askedfor.app as primary, askedfor.dev as a redirect, tryaskedfor.com as a backup. All three were available to register on 13 Oct 2026; askedfor.com is taken. Run the trademark search in Hard compliance rules before buying.
- **Tagline:** Who to reply to today. What to build next.
- **Positioning:** Lead feeds tell you who to reply to. AskedFor tells you that, and what to build next, without scraping.
- **Audience:** indie makers and small software teams before or just after product-market fit. Same audience as Ownfeed, so we win on the second job and on trust, not on who we sell to.

**The two jobs**

1. **Reply (tab 1):** a daily list of public posts where someone describes the problem you solve, asks for a tool like yours, or mentions you or a competitor. You reply yourself, in your own words.
2. **Build (tab 2):** the patterns behind those posts. Themes with counts and trends, what people wish existed, and why they leave competitors, each linked to the posts that prove it. Plus a weekly "what to build next" digest.

Early users matter most for what they teach you, but payment is the strongest feedback there is, so AskedFor charges from day one.

**What AskedFor is not**

- **Not a scraper:** official APIs, plus search links the user opens themselves.
- **Not an auto-replier:** it never posts, likes, follows or messages anyone, and never writes replies for users.
- **Not a people database:** it stores the minimum, deletes raw posts after 30 days, and the Build tab shows themes, not profiles.

## Hard compliance rules

**These rules override everything else in this brief. If a feature can't be built within them, it doesn't get built.**

### Data sources

- Only collect from sources on the allowlist in the Data sources section. Each source module declares its access method, terms link and allowed hosts, and CI fails if code calls any other host.
- No scraping, no headless browsers against third-party sites, and no scraping services (Bright Data, Apify, SerpApi, Oxylabs or similar) for any source. Reddit is suing scraping providers, and in July 2026 a judge largely refused to dismiss its case against SerpApi.
- Reddit, LinkedIn, Facebook, Instagram, TikTok, Threads, YouTube and Discord are never collected. They get search links the user opens in their own browser.
- Product Hunt is not a data source: its API terms ban commercial use without permission.
- **Bluesky:** follow the Bluesky Developer Guidelines. No automated or bulk interactions, a public contact email someone monitors, reasonable security.
- **X (phase 2 only):** official API, pay-per-use, a hard daily read budget per customer. The use case you declare to X is binding, so declare this one honestly. Honour post deletions and don't train models on X content.
- **Hacker News:** official Firebase API and the Algolia HN Search API, polite request rates, always link back to the item.
- Platform names appear in text only. No platform logos without written permission; Bluesky's trademark policy, for example, allows plain-words description of a service but needs written permission for other commercial use of its marks.

### What our users can do

- AskedFor never posts, replies, votes, follows or messages on any platform. No browser extension in v1.
- No AI-written replies. The app can show reply tips, but the user writes every word.
- Every reply surface shows a disclosure reminder: "Say you built it." UK consumer law, the CAP Code and the US FTC's endorsement rules all expect a commercial connection to be clear.
- The acceptable use policy bans spam, copy-paste mass replies, sock puppets and building contact lists from the feed.

### Privacy (UK GDPR, we are the controller)

- Pay the ICO data protection fee before launch.
- Lawful basis is legitimate interests, backed by a written Legitimate Interests Assessment.
- Do a DPIA before launch. We process personal data not collected from the people it's about, and the ICO lists this "invisible processing" as needing one.
- Publish an Article 14 notice for the people whose posts we process: what we collect, why, how long we keep it, how to object. Link it in every page footer.
- Minimise: store post URL, source, posted time, an excerpt of at most 280 characters, labels, and the author handle only where the Reply tab needs it. Keep a hash of the handle for suppression. No avatars, bios or follower counts.
- Retention: raw posts are deleted 30 days after collection. After that the Build tab keeps only theme counts and summaries with no names or quotes.
- Rights: a public "Remove my post" form, handled within 30 days (target 72 hours). Removed authors go on a suppression list and are never collected again. Posts deleted at the source get deleted here too.
- Never infer or tag sensitive traits (health, politics, religion, sexuality, ethnicity) about anyone. Classifier prompts must not ask for them.
- Sign DPAs with every processor (Supabase, Vercel, Anthropic, Resend, the payment provider, error monitoring) and record how each international transfer is covered. Host the database in Supabase's London region.
- Security: row-level security on every table, secrets server-side only, an audit log for admin actions, and a breach plan (reportable breaches go to the ICO within 72 hours).
- Cookies: essential only. Analytics must be cookieless, or consent comes first (PECR).
- The service is 18+. Post authors can be minors, one more reason to store little and delete fast.

### Payments and consumer law

- Use a merchant of record so VAT and sales tax are handled for you: Stripe Managed Payments if your account is eligible (UK businesses are listed), otherwise Paddle.
- Build the subscription flow to the DMCC Act subscription rules now; they're due to start in January 2027. That means clear price, renewal and cancellation terms before checkout, a reminder before a trial turns paid, and online cancellation as easy as signing up.
- Default: 7-day trial, card required, reminder email 48 hours before the first charge, cancel in two clicks from Settings.
- Show the full price up front, tax included where it applies. Hidden mandatory charges (drip pricing) have been banned in the UK since April 2025.
- Refunds and cooling-off follow the Consumer Contracts Regulations. State them plainly in the terms.

### Marketing and launch

- No fake or AI-generated testimonials, reviews, user counts, "as seen on" badges or activity screenshots. Fake reviews have been banned outright in the UK since April 2025. A testimonial needs the person's written permission and their real words.
- Demo data on the site is labelled "Example" and uses invented handles that don't belong to real accounts.
- Don't name Ownfeed or any competitor on the site or in ads in v1. Any later comparison must be factual, current and fair.
- Every claim must be provable and logged in `docs/claims.md`. Describe what the product does, not outcomes it can't promise: no "find your first customers in 24 hours".
- Never ask for upvotes on Product Hunt or Hacker News, never trade votes, never buy engagement.
- Marketing email needs consent, or the soft opt-in for existing customers, plus an unsubscribe link (PECR). Never use scraped email addresses.

### IP, identity and tax

- Original design and copy. Don't copy Ownfeed's layout, wording, mascot, colours or illustrations.
- Trademark search for "AskedFor" at the UK IPO, EUIPO and USPTO (classes 9, 35 and 42) before buying domains or launching.
- Show short excerpts with a link to the original post, never whole republished posts.
- Put your trading name, a geographic address and a monitored email on the site (UK e-commerce rules). A business address service can keep your home address private; check it meets the rule.
- Register for Self Assessment with HMRC once trading income passes the £1,000 trading allowance, or set up a limited company.

## Data sources

**At launch AskedFor collects from Bluesky and Hacker News only; everything else is a search link the user opens.** That is thinner coverage than Ownfeed and it is the price of being legal, so the Build tab has to earn the subscription.

| Source | v1 status | How we access it | Conditions | Cost |
| --- | --- | --- | --- | --- |
| Bluesky | Collected | Official API search (`app.bsky.feed.searchPosts`) from a dedicated AskedFor account | Developer Guidelines; drop posts deleted at source; check current auth rules at docs.bsky.app before building | Free |
| Hacker News | Collected | Algolia HN Search API (`search_by_date`); official Firebase API to check an item still exists | Link back; polite rate | Free |
| X | Phase 2, off by default | Official X API v2, pay-per-use, recent search (last 7 days) | Hard daily read budget per customer; honour deletions; no model training | $0.005 per post read |
| Reddit | Search links only | Reddit search URLs (newest first) and suggested subreddits, opened by the user | No API, RSS, scraping or scraping services | Free |
| LinkedIn, Facebook, Threads, Indie Hackers, X before phase 2 | Search links only | Same pattern as Reddit | User opens them in their own browser | Free |
| Product Hunt | Not accessed | None | API terms ban commercial use without permission | None |
| Manual capture (v1.1) | User pastes | Text and link of a post the user found anywhere | Store only what they paste; author name off by default | Free |

**Why Reddit is links only:** Reddit stops accepting new public API access requests on 31 Oct 2026, ends RSS on 13 Nov 2026 and closes its public API in March 2027. Commercial use already needed Reddit's permission and a contract.

**X economics:** at $0.005 a read, 50 posts a day per customer costs about $7.50 a month, and 500 a day costs about $75, more than the subscription. So X ships as a paid add-on with a hard budget, or not at all. Re-reading the same post within 24 hours (UTC) is charged once, so dedupe within the day.

**Source module contract** (Claude Code follows this exactly)

- Each source lives in `src/sources/<id>.ts` and exports `id`, `mode` (`collect` or `link`), `termsUrl`, `allowedHosts`, `dailyBudget`, plus `collect()` in collect mode or `searchLinks()` in link mode.
- `src/sources/registry.ts` is the only allowlist. All outbound HTTP goes through `safeFetch()`, which throws on any host outside the union of `allowedHosts`.
- The one exception is onboarding: `fetchOwnSite()` may fetch the user's own product URL once, with SSRF protection (https only, no private or local IPs, size and time limits, no redirects off the domain).
- Every source has an env kill switch (`SOURCE_<ID>_ENABLED`), so a source can be paused in minutes if its terms change.

## MVP features and milestones

**Eight milestones, each shippable and testable on its own.** Claude Code turns these into `docs/TASKS.md`.

| Milestone | What ships | Done when |
| --- | --- | --- |
| M0 Foundations | Repo, Next.js app, Supabase project (London), CI, `npm run check`, compliance gates, placeholder legal pages | CI is green on an empty app; a test proves `safeFetch` blocks a host off the allowlist |
| M1 Onboarding | Sign-in (magic link, Google); paste product URL; AI drafts name, what it does, audience, competitors and 20 to 30 search terms; user edits and confirms | Draft appears within 2 minutes; every field editable; nothing is collected before the user confirms; private IPs and non-https URLs are refused |
| M2 Collection | Daily Bluesky and HN collectors per product, retention purge, suppression list, deletion sync | Fixture tests: posts older than 30 days are purged, suppressed authors are never stored, no run exceeds its budget |
| M3 Classifier | Relevance score 0 to 100; category (Looking for a tool, Pain point, Mentions you, Mentions a competitor, Wish); one-line reason; dedupe | On 100 posts you label by hand, precision is at least 0.8 at the default threshold; output always matches the JSON schema; the schema has no sensitive-trait fields |
| M4 Reply tab | Today and All views; filter by category and source; save, replied, hide; open original; reply tips and the disclosure reminder; search links per term | 200 items load in under 1.5 seconds; marking Replied removes a post from Today; every card shows source, age, category, excerpt and link |
| M5 Build tab | Weekly themes with count and trend, up to 3 linked excerpts each, "leaving [competitor] because", "wished it existed"; Markdown export; Monday digest email | Themes regenerate weekly; no author names appear anywhere in the Build tab; the digest has a working unsubscribe link |
| M6 Billing | Merchant of record checkout, 7-day trial, reminder 48 hours before charge, two-click cancel, account deletion, data export | Price and renewal terms shown before checkout; the reminder fires in a time-travel test; cancel and delete work end to end in test mode |
| M7 Launch surface | Landing page, instant preview (no sign-up), final legal pages, removal form with admin queue, sources page | Every site claim has an entry in `docs/claims.md`; the removal form deletes and suppresses in one admin click; the preview is rate-limited and keeps nothing past 24 hours |

**Success metrics for the PRD:** activation (profile confirmed and first feed opened within 24 hours), weekly active users (Reply tab opened 3 or more days a week), replies marked per user per week, digest open rate, trial-to-paid conversion and 30-day retention. Ask every paying user once: "Did the Build tab change what you built?"

**Out of scope for v1:** automated Reddit or Facebook collection, any posting or reply drafting, browser extensions, team seats, an API, and Product Hunt data.

## Landing page spec

**One page that shows both jobs in action, says plainly where the data comes from, and lets people try it without signing up.**

Sections, top to bottom:

1. **Hero.** Headline: "Who to reply to today. What to build next." Subhead: "AskedFor reads public conversations about the problem you solve, then shows you the people worth replying to and the patterns in what they ask for." Buttons: "Try it on your product" (instant preview) and "Start 7-day trial". Under them, the full price and renewal terms in one line.
2. **The two tabs, side by side.** Left, Reply: three example post cards with category tags. Right, Build: three themes with counts and a small trend line. Label both "Example data".
3. **How it works.** Paste your URL. We search the places we're allowed to. You reply in your own words and decide what to build. Draw it as one left-to-right strip, not three numbered cards.
4. **Where your data comes from.** Plain text, no logos: "Collected through official APIs: Bluesky, Hacker News. One-tap searches you open yourself: Reddit, X, LinkedIn, Facebook. We never scrape, never post for you, and delete raw posts after 30 days." This is the trust section; make it prominent.
5. **Pricing.** One plan, monthly price, 7-day trial, what renews when, how to cancel.
6. **FAQ.** Does it post for me? Why isn't Reddit collected automatically? What do you store and for how long? You show a post I wrote, how do I remove it? Can I cancel any time?
7. **Footer.** Contact email, trading name and address, Privacy notice, "Remove my post", Terms, Acceptable use.

No testimonials section until real ones exist with written permission. No Product Hunt badge until after launch.

**Instant preview:** a visitor enters a URL and gets the top 5 Bluesky and HN posts from the last 24 hours plus one starter theme. No account, rate-limited per IP, results deleted after 24 hours. This is what makes a Show HN possible.

**Visual direction (deliberately unlike Ownfeed).** Ownfeed is grey-white, black sans headlines, pill buttons and a white blob mascot. AskedFor goes warm and editorial:

- Warm off-white paper background, near-black ink text, one accent: deep ink blue.
- An editorial serif for headlines (for example Fraunces or Instrument Serif) and a clean sans for UI (for example Geist or IBM Plex Sans).
- Signature element: a highlighter mark over the exact words in a post where someone asks for something. The brand in one gesture: we find what was asked for.
- No mascot. Cards with thin rules and squarer corners, generous whitespace, a real dark mode.
- WCAG 2.2 AA contrast, fully keyboard navigable, works at 375 px wide.

**Copy rules:** plain and specific, no hype words ("revolutionary", "10x"), no em dashes, one spelling standard (US English suits this audience), every number provable.

## Tech stack and architecture

**Same tools you already use (GitHub, Vercel, Supabase, Stripe), plus the Anthropic API for classification and weekly themes.**

[Embedded diagram not exported: AskedFor v1 data flow, 7 parts]

Only Bluesky and Hacker News reach the posts store; everything else stays a link the user opens until manual capture lands in v1.1. Raw posts expire after 30 days, so the Build tab keeps themes, not people.

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js (App Router), TypeScript strict, Tailwind | One codebase for site and app, Vercel-native |
| Data and auth | Supabase Postgres in London, Supabase Auth (magic link, Google), RLS on every table | UK data residency; you already know it |
| Jobs | Vercel Cron calls daily and weekly routes that work through a jobs table in batches; move to Inngest or Trigger.dev if runs hit function time limits | Simple first |
| AI | Anthropic API: `claude-haiku-5-5` for classification, `claude-sonnet-5-5` for weekly themes; JSON schema outputs; prompt caching on the product profile | Cheap per post, strong weekly synthesis |
| Email | Resend for sign-in, trial reminders and the digest | Simple, offers a DPA |
| Payments | Stripe Managed Payments (merchant of record) or Paddle | VAT handled for you |
| Monitoring | Sentry with PII scrubbing on | Errors without leaking post text |
| Analytics | Cookieless (Plausible or similar) or none at launch | No consent banner needed |

Check current model names and prices in Anthropic's docs before building, and put a per-customer cost estimate in the PRD.

**Core tables**

- `profiles`: user id, plan, trial end, marketing opt-in.
- `products`: owner, URL, name, description, audience, competitors, status.
- `search_terms`: product, term, active.
- `posts`: source, external id, URL, excerpt (max 280 chars), posted at, collected at, `delete_after`, `author_hash`, `author_handle` (nullable).
- `product_posts`: product, post, relevance, category, reason, state (new, saved, replied, hidden).
- `themes`: product, week, title, summary, count, trend, example post ids (cleared when the posts expire).
- `suppression`: author hash, source, reason, created at.
- `removal_requests`: link or handle, contact email, status, timestamps.
- `usage_ledger`: product, source, reads, cost, date (enforces budgets).
- `audit_log`: actor, action, target, time.

**Scheduled jobs:** daily collect per product and source within budget, classify in batches, deletion sync (drop posts gone at source), daily retention purge, weekly themes on Sunday night with the digest on Monday morning UK time, and an hourly check for trial reminders.

## CLAUDE.md contents

**Claude Code writes this file in Phase 0, under 200 lines, with longer rules split into ********.** CLAUDE.md guides Claude; hooks and CI do the enforcing.

```markdown
# AskedFor

Who to reply to today. What to build next. Indie makers get a daily list of public posts worth replying to (Reply tab) and the patterns in what people ask for (Build tab), from allowed sources only.

Scope: @docs/PRD.md
Full brief, read when a task needs it: `docs/BRIEF.md`
Tasks: `docs/TASKS.md` (tick boxes as you finish)
Claims register: `docs/claims.md`

## Commands
- `npm run dev`: local app
- `npm run check`: typecheck, lint, unit tests, compliance gates. Must exit 0 before any task is done.
- `npm run test:e2e`: Playwright against localhost only
- `npm run db:migrate`, `npm run db:types`: Supabase migrations and generated types

## Stack
Next.js App Router, TypeScript strict, Tailwind, Supabase (London, RLS on every table), Vercel Cron, Anthropic API, Resend, merchant-of-record billing.

## Non-negotiables
- All outbound HTTP goes through `safeFetch()` in `src/server/net/`. Only hosts in `src/sources/registry.ts` are allowed, plus `fetchOwnSite()` for the user's own URL during onboarding.
- Never add scraping tools or services: no Puppeteer or Playwright against third-party sites; no Apify, Bright Data, SerpApi, Oxylabs or similar SDKs.
- Never build anything that posts, replies, votes, follows or messages on any platform.
- Never generate replies for users. Reply tips are fine; the user writes the words.
- Store the minimum: excerpt max 280 chars; no avatars, bios or follower counts. Every write path respects `delete_after` and the suppression list.
- The Build tab never shows author names or handles.
- Never infer or store sensitive traits about anyone.
- Never write fake testimonials, reviews, user counts, badges, logos or "as seen on". Every public claim needs an entry in `docs/claims.md`.
- Platform names in text only; no third-party logos in `public/`.
- No em dashes in UI copy or emails.

## Conventions
- Validate all external input with zod at the boundary.
- The Supabase service-role key lives only in `src/server/`; never import it in client code.
- All model calls go through `src/server/llm/` with JSON schema outputs and logged token usage.
- Each source is a module in `src/sources/` following `.claude/rules/data-sources.md`.
- Feature flag per source (`SOURCE_<ID>_ENABLED`); X is off by default.

## Testing
- Record fixtures; CI never calls live third-party APIs.
- Every source module, the classifier schema, retention, suppression and trial reminders have tests.

## Definition of done (every task)
1. The acceptance test from `docs/TASKS.md` is written first and passes.
2. `npm run check` exits 0.
3. compliance-reviewer subagent: no blocking findings.
4. Box ticked in `docs/TASKS.md`, one focused commit.

## Ask before you
- Change data sources, stored fields, retention, billing, pricing or any public claim.
- Delete data, run production migrations, or touch live keys.
```

**Path-scoped rules in ****** (each loads only when Claude works on matching files)

- `data-sources.md` (paths `src/sources/**`, `src/server/net/**`): the source module contract, budgets, kill switches, deletion sync, rate limits.
- `privacy.md` (paths `supabase/migrations/**`, `src/server/**`): minimisation, retention, suppression, RLS, audit log.
- `copy.md` (paths `src/app/(marketing)/**`, `emails/**`, `docs/claims.md`): copy rules, disclosure wording, banned phrases, claims register.
- `testing.md` (no paths, always loaded): fixtures only, E2E against localhost only.

## Quality loop

**The loop is Claude Code's ********: after every turn a separate model checks your completion condition, and Claude keeps working until it holds.** Tests, hooks and CI decide what "done" means, not Claude's opinion of its own work.

**Inside every task**

1. Read the task's acceptance test in `docs/TASKS.md`.
2. Write the test first, then the smallest change that passes it.
3. Run `npm run check`.
4. Ask the code-reviewer and compliance-reviewer subagents to find problems, not to approve.
5. Fix every blocking finding and run the checks again.
6. Tick the box, commit, take the next task. When every box in the milestone is ticked and checks pass, the goal's evaluator ends the loop.

**Writing goal conditions:** state an end Claude can prove in the transcript (an exit code, a test result, an empty findings list), name what must not change, and add "or stop after N turns" so a stuck loop ends. Use the template in the kickoff section, one goal per milestone.

**Subagents** (`.claude/agents/`)

- `compliance-reviewer`, read-only tools: checks each diff against Hard compliance rules. New outbound hosts, new stored fields, retention and suppression paths, claims missing from `docs/claims.md`, logos, a missing disclosure reminder, cookie or analytics changes. Returns BLOCKING and NON-BLOCKING findings with file and line.
- `code-reviewer`, read-only tools: correctness, security (RLS, secrets, SSRF, injection), missing tests, performance.

**Hooks** (`.claude/settings.json`)

- PreToolUse on Bash: deny installing denylisted packages (scraping SDKs, stealth browser plugins).
- PostToolUse on Edit and Write: run the formatter and a fast lint on the changed file.
- Optional Stop hook: run `npm run check` so no turn ends on a red build.

**CI gates** (GitHub Actions, every push)

- `compliance:hosts`: static scan plus a runtime test that `safeFetch` blocks everything off the allowlist.
- `compliance:deps`: fails if a denylisted package is in the lockfile.
- `compliance:schema`: fails if a migration adds avatar, bio, follower or email columns to post tables.
- `compliance:copy`: scans marketing pages and emails for em dashes, banned hype words, numbers missing from `docs/claims.md`, and third-party logo files.
- Unit tests for retention, suppression, budgets and the trial reminder.

Run `/code-review` on each milestone's diff as a final pass before you merge.

**Human checkpoints (you, not Claude)**

- After Phase 0: approve the PRD, CLAUDE.md and TASKS.md.
- Before M6 goes live: run test-mode payments end to end, then switch to live yourself.
- Before M7 publishes: read every claim on the site against `docs/claims.md`.
- Before launch: the checklist in the last section.

## Launch plan and platform rules

**Launch on Product Hunt once 10 or more real users have used AskedFor for a week; do Show HN only when the instant preview works without sign-up.**

**Before launch (2 to 3 weeks)**

- Use AskedFor on AskedFor. Reply to people asking how to find first users, as yourself, saying you built it.
- Get 10 to 20 beta users. GummySearch shuts down completely on 1 December 2026, so its last users are hunting for a replacement. Be upfront that Reddit isn't collected automatically, and why.
- Collect real quotes, with written permission, for the site.

**Product Hunt**

- Launch from your own maker account with an honest maker comment: you kept stalling on first customers, so you built the tool you needed.
- Ask for feedback and comments, never upvotes. No vote swaps, bought votes or fresh-account rings; Product Hunt is reported to discount votes from newly created accounts.
- A launch-day offer (say, a longer trial) is fine. Never tie it to upvoting.

**Show HN**

- Only once people can try it without signing up. The Show HN rules rule out sign-up pages and landing pages.
- Title without dashes, for example: "Show HN: AskedFor, who to reply to and what to build next".
- Don't ask friends to upvote or comment; HN treats that as a voting ring.
- Stay in the thread for the first few hours to answer questions.

**Other places** (read each one's rules first, and say you're the maker): Indie Hackers for a build-in-public post, BetaList, Peerlist, Uneed, Microlaunch. On Reddit, post only in subreddits whose current rules allow self-promotion, such as r/SideProject.

**Launch assets:** a 30-second demo video, 3 to 5 screenshots with labelled example data, the maker comment, and ready answers on sources and privacy.

## Open decisions and pre-launch checklist

**Five calls only you can make, then a checklist to get reviewed by a UK solicitor or compliance service before you take money.**

| Decision | Default in this brief | Revisit when |
| --- | --- | --- |
| Price | $29 a month, 7-day trial, card required | After 20 paying users |
| X | Off at launch; later a paid add-on, about $15 a month for up to 50 X posts a day (about $7.50 of API cost) | 5 or more users ask for it |
| Spelling | US English across site and app | Only if you go UK-only |
| Legal form | Sole trader | Revenue or risk grows; ask an accountant |
| Reddit | Search links only; email Reddit about data access in parallel, never depend on it | Reddit offers terms you can afford |

**Pre-launch checklist**

- ICO data protection fee paid
- Legitimate Interests Assessment and DPIA written and filed
- Privacy notice live, covering users and the people whose posts we process
- "Remove my post" form tested end to end, suppression confirmed
- DPAs signed with every processor, transfer mechanisms recorded
- Terms, acceptable use policy and cookie notice live
- Trading name, geographic address and contact email on the site
- Checkout shows price, renewal and cancellation before payment; trial reminder and two-click cancel tested
- Each source's terms re-read in launch week; Bluesky contact email live; X off or budgeted
- Every site claim backed in `docs/claims.md`; no testimonials without written permission; no third-party logos; example data labelled
- Trademark search done for AskedFor, domains bought
- HMRC registration sorted

## Sources

Checked while writing this brief on 13 Oct 2026. Terms change: re-read the platform ones in launch week.

- [Ownfeed privacy policy](https://ownfeed.dev/privacy): collection through Bright Data and Apify
- [TechWyse: Reddit ends RSS, shuts public API by March 2027](https://www.techwyse.com/news/social-media/reddit-rss-feeds-ending-public-api-shutdown-2027)
- [TechRepublic: Reddit is killing RSS and public API access](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/)
- [Reddit API access in 2026: commercial use needs a contract](https://apiserpent.com/blog/reddit-search-api-2026-access)
- [Bloomberg Law: Reddit sues Perplexity, SerpApi, Oxylabs and AWMProxy](https://news.bloomberglaw.com/business-and-practice/reddit-sues-perplexity-others-over-alleged-data-scraping)
- [Reddit's case against SerpApi survives a dismissal motion](https://www.kucoin.com/news/flash/reddit-lawsuit-against-serpapi-survives-dismissal-motion)
- [Bluesky Developer Guidelines](https://docs.bsky.app/docs/support/developer-guidelines)
- [Bluesky Trademark Policy](https://bsky.social/about/support/trademarks)
- [X API pricing in 2026 (Postproxy)](https://postproxy.dev/blog/x-api-pricing-2026)
- [Hacker News API guide: Algolia and Firebase](https://cotera.co/articles/hacker-news-api-guide.md)
- [Product Hunt API 2.0 docs](https://www.producthunt.com/v2/docs)
- [Show HN guidelines](https://news.ycombinator.com/showhn.html)
- [Product Hunt launch rules (Stackmatix)](https://www.stackmatix.com/blog/launching-on-product-hunt)
- [Product Hunt launch playbook (Demand Curve)](https://demandcurve.com/playbooks/product-hunt)
- [ICO: processing likely to result in high risk](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk)
- [TLT: DMCC subscription regime brought forward to January 2027](https://www.tlt.com/insights-and-events/insight/dmcc-act-subscription-contracts-regime-brought-forward-by-the-pm-what-do-businesses-need-to-know)
- [Lewis Silkin: the subscription shake-up, January 2027](https://www.lewissilkin.com/insights/2026/09/15/key-takeaways-the-subscription-shake-up-are-you-ready-for-january-2027-102o14n)
- [Acquired: drip pricing banned since April 2025](https://www.acquired.com/blog/dmcca-subscription-legislation-january-2027/)
- [Subtracker: DMCC unfair-practices rules in force since April 2025](https://subtracker.io/best/uk-dmcc-subscription-rules)
- [Stripe Managed Payments docs](https://docs.stripe.com/payments/managed-payments)
- [GummySearch closure timeline](https://gummysearch.com/docs/articles/gummysearch-is-now-closed-6533h)
- [Claude Code: /goal](https://code.claude.com/docs/en/goal.md)
- [Claude Code: CLAUDE.md and .claude/rules](https://code.claude.com/docs/en/memory.md)
- [Claude Code: /loop and scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks.md)
- [Claude Code docs map: subagents, hooks, code review](https://code.claude.com/docs/en/claude_code_docs_map.md)

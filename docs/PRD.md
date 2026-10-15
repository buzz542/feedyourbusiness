# AskedFor: Product requirements

> **Superseded on 14 Oct 2026 by `docs/PLAN.md`.** The founder chose route C (decision D1): Reddit is
> collected through a contracted data vendor, X through its official API, and a Rivals tab joins Reply and
> Build. This file is kept as history. Where it and the plan disagree, the plan wins. The hard rules below
> are the brief's original text; the rules in force are `docs/PLAN.md` section 2.

Status: superseded (see the note above). Originally derived from `docs/BRIEF.md`.

## Problem

Indie makers before or just after product-market fit stall on two questions: who should I talk to today, and
what should I build next. Lead feeds answer the first, mostly by scraping platforms that are closing or suing
scrapers. Nothing answers the second from the same conversations.

## Users

Indie makers and small software teams (one to a handful of people), 18 or older, who reply to people in their
own words. Not agencies, not growth teams running outreach at volume.

## The two jobs

1. **Reply.** A daily list of public posts where someone describes the problem you solve, asks for a tool like
   yours, or mentions you or a competitor. The user replies themselves, in their own words, saying they built it.
2. **Build.** The patterns behind those posts: themes with counts and trends, what people wish existed, why they
   leave competitors, each linked to the posts that prove it, plus a weekly "what to build next" digest.

## What AskedFor is not

Not a scraper (official APIs plus search links the user opens). Not an auto-replier (it never posts, likes,
follows or messages, and never writes replies). Not a people database (minimum stored, raw posts deleted after
30 days, the Build tab shows themes not profiles).

## MVP scope

Collected sources at launch: Bluesky and Hacker News only. Everything else is a search link the user opens.

| Milestone | What ships | State |
| --- | --- | --- |
| M0 Foundations | Repo, Next.js app, Supabase (London), CI, `npm run check`, compliance gates, placeholder legal pages | Built. CI run on GitHub and Vercel setup pending |
| M1 Onboarding | Sign-in (magic link, Google), paste product URL, AI drafts profile and 20 to 30 search terms, user confirms | Not started |
| M2 Collection | Daily Bluesky and HN collectors, retention purge, suppression, deletion sync | Not started |
| M3 Classifier | Relevance 0 to 100, category, one-line reason, dedupe | Not started |
| M4 Reply tab | Today and All views, filters, save/replied/hide, reply tips, disclosure reminder, search links | Not started |
| M5 Build tab | Weekly themes, linked excerpts, Markdown export, Monday digest | Not started |
| M6 Billing | Merchant of record checkout, 7-day trial, 48 hour reminder, two-click cancel, account deletion, export | Plumbing built and tested in test mode. Needs Stripe connected, UI and an end-to-end run |
| M7 Launch surface | Landing page, instant preview, final legal pages, removal form, sources page | Not started |

## Out of scope for v1

Automated Reddit or Facebook collection, any posting or reply drafting, browser extensions, team seats, an API,
and Product Hunt data. X is phase 2, off by default, and only as a paid add-on with a hard daily read budget.

## Success metrics

- Activation: profile confirmed and first feed opened within 24 hours of sign-up.
- Weekly active users: Reply tab opened on 3 or more days in a week.
- Replies marked per user per week.
- Digest open rate.
- Trial-to-paid conversion and 30-day retention.
- Ask every paying user once: "Did the Build tab change what you built?"

Measuring these needs minimal first-party event data. See `docs/PHASE0-FINDINGS.md`, item 12.

## Acceptance criteria per feature

| Feature | Done when |
| --- | --- |
| Foundations | CI is green on an empty app. A test proves `safeFetch` blocks a host off the allowlist. |
| Onboarding | Draft appears within 2 minutes. Every field is editable. Nothing is collected before the user confirms. Private IPs and non-https URLs are refused. |
| Collection | Fixture tests: posts older than 30 days are purged, suppressed authors are never stored, no run exceeds its budget. |
| Classifier | On 100 hand-labeled posts, precision is at least 0.8 at the default threshold. Output always matches the JSON schema. The schema has no sensitive-trait fields. |
| Reply tab | 200 items load in under 1.5 seconds. Marking Replied removes a post from Today. Every card shows source, age, category, excerpt and link. |
| Build tab | Themes regenerate weekly. No author names appear anywhere in the tab. The digest has a working unsubscribe link. |
| Billing | Price and renewal terms are shown before checkout. The reminder fires in a time-travel test. Cancel and delete work end to end in test mode. |
| Launch surface | Every site claim has an entry in `docs/claims.md`. The removal form deletes and suppresses in one admin click. The preview is rate-limited and keeps nothing past 24 hours. |

## Pricing and cost

Default: $29 a month, 7-day trial, card required. Revisit after 20 paying users.

Estimated model cost per customer per month. These are estimates built on assumptions, not measurements.
M3 logs real token usage per call so this table can be replaced with data.

Model prices are Anthropic's published first-party rates as cached on 6 Oct 2026: `claude-haiku-5-5` $0.10 per
million input tokens and $0.50 per million output tokens (prompts up to 100K tokens); `claude-sonnet-5-5` $2 input
and $10 output. Re-check them before building.

| Task | Model | Assumption | Cost per month |
| --- | --- | --- | --- |
| Classify candidate posts | Haiku 5.5 | 500 candidate posts a day, about 400 uncached input tokens and 60 output tokens each | about $1.05 |
| Weekly themes | Sonnet 5.5 | About 16K input and 1.5K output tokens a week | about $0.21 |
| Onboarding draft | Sonnet 5.5 | One time, about 8K input and 1.5K output tokens | about $0.03 once |

Total is roughly $1.30 a month at these volumes, and about $5.50 if candidate volume were five times higher. It
excludes payment and merchant-of-record fees, which are not yet known, and fixed costs (Supabase, Vercel, Resend,
error monitoring). The 500 posts a day figure is a guess and is the number most worth measuring first.

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

## Open questions and gaps

Every contradiction, gap and risky assumption found while preparing this PRD, with a proposed fix, is in
`docs/PHASE0-FINDINGS.md`. Approve or amend it before M1 starts.

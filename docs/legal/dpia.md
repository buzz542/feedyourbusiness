# Data Protection Impact Assessment (draft)

## Why a DPIA

AskedFor processes public posts of people who are not its customers (invisible processing), at scale, partly through a data vendor (Bright Data) for Reddit. That makes a DPIA necessary.

## Description of processing

- Sources: Hacker News (official APIs), Bluesky (official API, read-only, from AskedFor's own account), Reddit (Bright Data's Web Scraper API, Reddit posts dataset, logged-out public pages), X (official API, off by default).
- Fields stored per post: link, source, community, posted time, excerpt (280 characters at most), labels, keyed hash of the author's account id (HMAC with a secret pepper that never rotates).
- Retention: Reddit and X 7 days; Hacker News and Bluesky 30 days. Database check constraints enforce it; a purge job deletes expired rows daily.
- Recipients: the customer whose product matched the post. Processors: Supabase, Vercel, Anthropic, Resend, Stripe, Bright Data.

## Vendor collection (Reddit)

- Bright Data collects public Reddit pages for us, logged out, through pinned dataset ids. Our code refuses any other dataset or API path on the vendor host.
- This is not a data license from Reddit. Reddit's user agreement does not allow collection without permission, and Reddit has sued scraping providers. The founder accepted this risk (decision D1). Mitigations: excerpts only, links back, 7-day retention, low volume, kill switch, a licensed-access request in parallel (F9), and a provider port so a licensed feed can replace the vendor.
- Before Reddit is switched on: signed DPA with Bright Data, recorded transfer mechanism, Bright Data named in the privacy notice and on the sources page, and this DPIA signed. The code refuses to start Reddit until `BRIGHTDATA_DPA_SIGNED_ON` holds a date and the vendor's snapshot retention is recorded.
- Snapshot retention at Bright Data: to be confirmed in writing and recorded in `src/sources/reddit.ts` and the privacy notice.

## The Reddit deletion gap

Reddit posts are re-checked once through the vendor about 72 hours after collection and deleted here if gone or removed at the source. A post deleted after that re-check stays until day 7. Accepted as residual risk because retention is short.

## Bluesky DIDs in links

Links to Bluesky posts use the author's DID, a stable public id that resolves to their handle. The handle itself is never stored. The privacy notice says so.

## Sensitive data

- Reddit communities about special-category topics are dropped before classification or storage (`src/sources/sensitive-communities.ts`, reviewed by the founder before Reddit is switched on and in launch week).
- People sometimes disclose health or similar details in their own public posts elsewhere. Where such a post is stored, the Article 9(2)(e) condition (manifestly made public by the data subject) is relied on, with the short retention and no inference. Prompts forbid inferring sensitive traits; no output schema has a field for one (`src/server/llm/sensitive-guard.test.ts`).

## Risks and mitigations

| Risk                                 | Likelihood | Severity        | Mitigation                                                       |
| ------------------------------------ | ---------- | --------------- | ---------------------------------------------------------------- |
| Author did not expect commercial use | Medium     | Low             | Excerpts, links back, removal form, suppression, short retention |
| Re-identification across posts       | Low        | Medium          | No handles; author hash hidden from customers by column grants   |
| Sensitive trait exposure             | Low        | High            | Community filter, no inference, no trait fields                  |
| Vendor over-collection               | Medium     | Medium          | Pinned datasets and paths, field limits if available, DPA        |
| Platform objection (Reddit)          | Medium     | High (business) | Kill switch in minutes, licensed route in parallel               |
| Data breach                          | Low        | Medium          | RLS on every table, secrets server-side, breach plan             |

Signed off by: ____________ Date: ____________

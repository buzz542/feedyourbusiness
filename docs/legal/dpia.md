# Data protection impact assessment

Draft, 5 Nov 2026. Covers collecting public posts, including through a vendor (Bright Data for
Reddit), and the site reader.

## Processing

- **What.** Public posts from Hacker News (official API), Bluesky (official API, a dedicated
  account), X (official API, off by default) and Reddit (Bright Data's Web Scraper API, Reddit posts
  dataset, logged-out public pages). Stored: link, community, posted time, excerpt (at most 280
  characters), labels, keyed hash of the author id.
- **Invisible processing.** Posters are not told directly. Mitigation: the Article 14 notice in
  every footer, the sources page, and the removal form. **Question:** is that enough for Article
  14(5)(b)?
- **Scale.** Small: per customer, up to about 30 stored posts a day.

## Risks and mitigations

| Risk                                                                  | Likelihood | Severity | Mitigation                                                                                                                                                               |
| --------------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reddit objects to vendor collection                                   | Medium     | High     | Kill switch per source, 7-day retention, excerpts only with links back, licensed access requested (F9), provider port to swap in a licensed feed                         |
| A sensitive trait revealed by a community name next to an author hash | Medium     | High     | Sensitive-community list and patterns drop those posts before labeling and storage (`src/sources/sensitive-communities.ts`, reviewed by the founder); no username stored |
| A deleted post stays visible                                          | Medium     | Low      | Hacker News and Bluesky deletion sync daily; X lookups; Reddit re-checked once at about 72 hours; the rest bounded by 7-day retention                                    |
| Reddit deletion gap                                                   | Known      | Low      | A post deleted after the 72-hour re-check stays until day 7. Turning the re-check off needs this DPIA and the privacy notice updated first                               |
| Bluesky links carry the author's DID                                  | Known      | Low      | The DID is a public id that resolves to the handle; the privacy notice says so                                                                                           |
| A person's handle tracked as a rival or a search term                 | Low        | Medium   | The database refuses handles, emails, URLs and profile links in competitor names, aliases and search terms                                                               |
| Vendor keeps snapshots                                                | Unknown    | Medium   | Reddit stays off until Bright Data's snapshot retention is known and stated in the privacy notice (enforced in code)                                                     |
| Breach of the database                                                | Low        | Medium   | RLS on every table, no API access for anonymous users, secrets server-side only, minimal fields; breach plan                                                             |

## Special category data

People sometimes mention health or similar details in their own public posts. **Question:** can we
rely on Article 9(2)(e) (made manifestly public by the data subject) for what remains after the
sensitive-community filter, given that we never infer or tag such traits?

## Site reader

Reads up to 6 pages of the customer's own site, never another site, platform, store, review or
profile page, honoring robots.txt for all but the pasted page (and the home page when the pasted
page is about people). The text goes to Anthropic to draft the product profile; nothing fetched is
stored. Risk: names of people on the customer's site. Mitigation: people pages are never read, and
the draft prompt and filters refuse names of people.

## Sign-off

To be signed by the founder before any collect source is switched on in production.

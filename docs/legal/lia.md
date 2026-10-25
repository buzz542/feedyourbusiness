# Legitimate Interests Assessment (draft)

Processing: collecting public posts that match a customer's product, storing a short excerpt with a link back, labeling them, and showing them to that customer so they can decide whether to reply in their own words.

## 1. Purpose test

- Interest: helping small software makers find people who publicly ask for, or complain about the lack of, a tool like theirs; and understanding what their competitors get wrong and what people want built.
- Benefit to the author: people who ask in public for a tool usually want answers. A maker's reply, which must disclose that they built the product ("Say you built it."), can answer them.
- Wider benefit: better products built from real requests.

## 2. Necessity test

- Only posts that match the customer's search terms are fetched, and only posts the classifier rates relevant (40 or more out of 100) are stored. The rest are discarded in memory.
- Fields kept: link, source, community, posted time, an excerpt of at most 280 characters, our labels, and a keyed hash of the author's account id. No usernames, avatars, bios, follower counts or emails.
- Retention: 7 days for Reddit and X, 30 days for Hacker News and Bluesky, enforced by the database.
- Aggregates (weekly themes, rival insights) keep counts and our own words, never names or quotes.
- Less intrusive alternative considered: search links the customer opens. These remain for platforms we never collect. They do not give customers the daily, labeled list the product exists for.

## 3. Balancing test

- Reasonable expectations: the posts are public, on platforms built for public discussion. Authors may not expect a commercial service to read them. Mitigations: excerpts only, link back to the original, short retention, no profiles, no handles, no contact data.
- Vulnerable people and sensitive topics: Reddit posts from communities about health, sexuality, religion, politics, ethnicity and similar topics are dropped before processing. Prompts forbid inferring sensitive traits and no output field can hold one.
- Control: anyone can ask for removal at /remove-my-post. One admin click deletes matching posts and adds the author hash to a suppression list, so the account is never stored again.
- Transparency: the privacy notice includes an Article 14 notice, linked from every footer.
- Harm: low. AskedFor never posts, replies, votes or messages, and the acceptable use policy bans spam, bulk messaging and contact lists.

## Outcome (to confirm)

Legitimate interests is the lawful basis, provided the mitigations above stay in place. Reassess before adding a source, a stored field or longer retention.

Signed off by: ____________ Date: ____________

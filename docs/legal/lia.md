# Legitimate interests assessment: collecting public posts

Draft, 5 Nov 2026. Controller: AskedFor (trading name and address to be added).

## 1. Purpose test

- **Interest.** Makers of small software products want to find public posts where people ask for
  a tool like theirs, describe the problem they solve, or mention a rival, so they can reply in
  their own words and say they built it. The people posting asked a public question and often want
  answers.
- **Whose interest.** AskedFor's commercial interest, our customers' interest in reaching people
  who asked, and the posters' interest in getting answers.
- **Lawful and ethical.** AskedFor never posts or replies for anyone, never writes replies, and
  bans spam, mass replies, sock puppets and contact lists (acceptable use policy).

## 2. Necessity test

- We could not do this with anonymous data: the point is to link to the post so a person can reply.
- We store the minimum: the link, community, posted time, an excerpt of at most 280 characters, our
  labels and a keyed hash of the author id. No usernames, avatars, bios or follower counts.
- Only posts the classifier rates relevant (40 or more out of 100) are stored; the rest are
  discarded in memory.
- Retention: 7 days for Reddit and X, 30 days for Hacker News and Bluesky, enforced by the database.
- Less intrusive alternatives considered: search links the user opens (used for LinkedIn, Facebook,
  Threads and others, which are never collected); a licensed Reddit feed (requested, F9).

## 3. Balancing test

- **Reasonable expectations.** The posts are public and were written to be read and answered. On
  Hacker News and Bluesky they are reached through official APIs. Reddit posts reach us through a
  vendor, which a poster may not expect (see the DPIA).
- **Impact.** Low: a public post is shown to a small number of makers, with a link back. No profile
  of any person is built: the author hash only lets us honor removals.
- **Sensitive data.** Posts from communities about health, sexuality, religion, politics,
  ethnicity and similar topics are dropped before labeling and storage; no prompt or schema infers
  sensitive traits. A person may still mention such details in an ordinary community; see the
  Article 9(2)(e) note in the DPIA.
- **Children.** The service is for adults; the sources' own terms set minimum ages.
- **Safeguards.** Article 14 notice on every page footer; a removal form handled within 30 days
  (target 72 hours) that deletes and suppresses; deletion sync with the sources; no training of
  any model on collected content.

## 4. Outcome

Legitimate interests can be relied on, with the safeguards above. **Question:** is this sound for
the Reddit vendor route given Reddit's user agreement (PLAN section 1, D1)?

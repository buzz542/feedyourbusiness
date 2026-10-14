---
paths:
  - "supabase/migrations/**"
  - "src/server/**"
  - "src/types/**"
---

# Privacy (UK GDPR, we are the controller)

Source of truth: `docs/PLAN.md`, section 2.3 and section 12. Changing stored fields, retention or
processors beyond what the plan specifies needs founder approval.

- Store the minimum. For a post: URL, source, community name, posted time, an excerpt of at most 280
  characters, labels, and a keyed hash of the author. No author handle for any source (D5): the column
  exists but is never written. Never an avatar, bio, follower count or email. `compliance:schema` enforces
  the column rule.
- Only posts the classifier rates relevant (40 or more) are stored. Everything else is discarded in memory.
- Vendor and API payloads are reduced to those fields at the adapter boundary. Raw payloads are never stored
  and never logged.
- Retention: Reddit and X posts are deleted 7 days after collection, Hacker News and Bluesky after 30 (D4).
  The database enforces it with check constraints, and `ingest_post` never extends it. The daily purge
  clears example ids from themes and rival insights. Aggregates keep no names and no quotes.
- Every write path respects `delete_after` and the `suppression` list; `ingest_post` checks suppression in
  the same statement that inserts. Removal requests: handle within 30 days, target 72 hours.
- Author hash: `HMAC-SHA256(AUTHOR_HASH_PEPPER, "<source>:<normalized author key>")`. The pepper never
  rotates. IP hashes for rate limits include the UTC day.
- Rivals, Build, digests, logs, error reports and analytics never contain author names or handles.
- Never infer or tag sensitive traits (health, politics, religion, sexuality, ethnicity and similar). No
  prompt asks for them and no output schema has a field for them.
- Row-level security on every table. New tables ship with RLS, explicit grants and a test in `tests/db/`.
  `anon` gets nothing. Narrow column grants for anything a user may write.
- The service-role key lives only in `src/server/`. Never import it from client code. Admin actions write
  to `audit_log`, which is append-only.
- Processors need a signed DPA and a recorded transfer mechanism before they are switched on in production
  (`docs/PLAN.md` 12.4, including Bright Data). A new outbound processor host goes in
  `src/server/net/hosts.ts` and the privacy notice.
- Cookies: essential only. Analytics are first-party and cookieless (the `events` table).
- Do not log request bodies, emails, post text, author ids or Stripe payloads. Log error class names only.

---
paths:
  - "supabase/migrations/**"
  - "src/server/**"
  - "src/types/**"
---

# Privacy (UK GDPR, we are the controller)

Source of truth: `docs/BRIEF.md`, "Privacy". Changing stored fields, retention or processors needs
founder approval.

- Store the minimum. For a post: URL, source, posted time, an excerpt of at most 280 characters,
  labels, a hash of the author handle, and the handle only where the Reply tab needs it. Never an
  avatar, bio, follower count or email. `compliance:schema` enforces the column rule.
- Retention: raw posts are deleted 30 days after collection. The database enforces the cap with
  `posts_retention_max_30_days`. After that the Build tab keeps only counts and summaries with no names
  or quotes. Themes clear `example_post_ids` when posts expire.
- Every write path respects `delete_after` and the `suppression` list. A suppressed author is never
  stored again. Removal requests: handle within 30 days, target 72 hours.
- The Build tab, the digest, logs, error reports and analytics never contain author names or handles.
- Never infer or tag sensitive traits (health, politics, religion, sexuality, ethnicity). Classifier
  prompts must not ask for them, and the output schema has no such fields.
- Row-level security on every table. New tables ship with RLS, explicit grants and a test in
  `tests/db/`. `anon` gets nothing. Narrow column grants for anything a user may write.
- The service-role key lives only in `src/server/`. Never import it from client code. Admin actions
  write to `audit_log`, which is append-only.
- Processors need a signed DPA and a recorded transfer mechanism before launch. A new outbound
  processor host goes in `src/server/net/hosts.ts` and the privacy notice.
- Cookies: essential only. Analytics cookieless, or consent first (PECR).
- Do not log request bodies, emails, post text or Stripe payloads. Log error class names only.

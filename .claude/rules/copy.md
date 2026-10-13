---
paths:
  - "src/app/(marketing)/**"
  - "emails/**"
  - "docs/claims.md"
---

# Copy and claims

Source of truth: `docs/BRIEF.md`, "Marketing and launch" and the landing page spec. `compliance:copy`
enforces the mechanical parts.

- Plain and specific. US English. No em dashes. No hype words ("revolutionary", "10x", "seamless",
  "unlock", "guaranteed" and the rest of `compliance/denylist.json`).
- Describe what the product does, not outcomes it cannot promise. No "find your first customers in
  24 hours".
- Every claim, and every number, is a row in `docs/claims.md` with its evidence, before it ships.
  Claim IDs use letters, never numbers.
- No fake or AI-generated testimonials, reviews, user counts, badges or activity screenshots. A real
  testimonial needs the person's written permission and their exact words. No testimonials section until
  real ones exist. No Product Hunt badge until after launch.
- Demo data is labeled "Example" and uses invented handles that belong to no real account.
- Do not name Ownfeed or any competitor in version 1.
- Platform names appear in text only. No platform logos without written permission.
- Every reply surface shows the disclosure reminder: "Say you built it."
- Never write replies for users. Reply tips are fine; the user writes every word.
- Marketing email needs consent or the soft opt-in, plus an unsubscribe link. Service emails (trial
  reminder, receipts) are not marketing. Never use scraped addresses.
- Never ask for upvotes on Product Hunt or Hacker News.

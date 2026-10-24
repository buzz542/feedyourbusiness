---
paths:
  - "src/app/(marketing)/**"
  - "src/app/(app)/**"
  - "src/app/(admin)/**"
  - "src/components/**"
  - "emails/**"
  - "docs/claims.md"
---

# Copy and claims

Source of truth: `docs/PLAN.md`, sections 2.5, 9.6 and decision D12. `compliance:copy` enforces the
mechanical parts.

- Plain and specific. US English. No em dashes. No hype words ("revolutionary", "10x", "seamless",
  "unlock", "guaranteed" and the rest of `compliance/denylist.json`).
- Describe what the product does, not outcomes it cannot promise. No "find your first customers in
  24 hours".
- Say plainly where posts come from: Hacker News and Bluesky through official APIs, Reddit through a
  third-party data provider, X through its official API when it is on, the rest as searches the user opens.
  Never claim "we don't scrape", "official APIs only" or anything that hides the data provider
  (`compliance:copy` blocks those phrases). The sources page and privacy notice name Bright Data and say it
  is not a data license from Reddit.
- Show the full price up front, tax included where it applies (no drip pricing).
- Every claim, and every number on a public page or in an email, is a row in `docs/claims.md` with its
  evidence, before it ships. Claim IDs use letters, never numbers. Numbers shown from live data inside the
  app are not claims. `src/components` is app scope (no numbers rule), so a shared component that a public
  page renders takes its numbers as props from the page, or lives in `src/app/(marketing)/_components`.
- No fake or AI-generated testimonials, reviews, user counts, badges or activity screenshots. A real
  testimonial needs the person's written permission and their exact words. No testimonials section until
  real ones exist. No Product Hunt badge until after launch.
- Demo data is labeled "Example", is invented, and shows no handles.
- Do not name any competitor on the site or in ads in version 1, and never copy a competitor's layout,
  wording, colors, mascot or illustrations.
- Platform names appear in text only. No platform logos without written permission.
- Every reply surface shows the disclosure reminder: "Say you built it."
- Never write replies for users. Reply tips are fixed copy; the user writes every word.
- Marketing email needs consent or the soft opt-in, plus an unsubscribe link. Service emails (trial
  reminder, daily posts, Monday digest, receipts) still carry a one-click unsubscribe where they repeat.
  Never use scraped addresses.
- Never ask for upvotes on Product Hunt or Hacker News.

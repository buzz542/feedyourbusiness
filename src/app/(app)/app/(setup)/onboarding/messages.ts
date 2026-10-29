import type { RefusalReason } from "@/server/onboarding/input";

/** What the onboarding box says when it cannot use what was pasted (docs/PLAN.md 4.3 step 2). */
export const OWN_SITE_ONLY =
  "We can only read your own website. Paste it, or describe your product in a sentence or two.";

export const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  platform: OWN_SITE_ONLY,
  third_party: OWN_SITE_ONLY,
  profile: OWN_SITE_ONLY,
  email: OWN_SITE_ONLY,
  handle: OWN_SITE_ONLY,
  invalid_url:
    "That doesn't look like a public website. Check the link, or describe your product in a sentence or two.",
  too_short: "Tell us a little more: a sentence or two about what your product does.",
  too_long: "Keep it to a few sentences, up to 1,000 characters.",
};

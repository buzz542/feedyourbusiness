/**
 * The express request to start the service during the cancellation period (docs/PLAN.md 2.4, 10.2).
 * DRAFT wording: a solicitor reviews it before live billing (docs/TASKS.md M8). Checkout records the
 * moment the box is ticked; the webhook stores it on the profile.
 */
export const CONSENT_TEXT =
  "Start my AskedFor service now. I understand the trial is free, and that if I cancel after it " +
  "has turned into a paid subscription but within my cancellation period, I may be charged for " +
  "the service I used.";

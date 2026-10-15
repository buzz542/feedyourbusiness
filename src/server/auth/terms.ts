import { z } from "zod";

/**
 * The two confirmations on first sign-in (docs/PLAN.md 4.3, 2.2.5): 18 or older, and the Terms and
 * Acceptable use policy. Stored once as profiles.terms_accepted_at; the database stamps the server
 * time and refuses later changes from API roles.
 */
export const termsInput = z.object({ adult: z.literal("on"), terms: z.literal("on") });

export interface TermsStore {
  /** Sets terms_accepted_at if it is not set yet. False when it was already set. */
  acceptTermsOnce(userId: string, now: Date): Promise<boolean>;
}

export async function acceptTerms(
  store: TermsStore,
  userId: string,
  input: unknown,
  now: Date,
): Promise<{ ok: true } | { ok: false; error: "confirm_both" }> {
  if (!termsInput.safeParse(input).success) return { ok: false, error: "confirm_both" };
  await store.acceptTermsOnce(userId, now);
  return { ok: true };
}

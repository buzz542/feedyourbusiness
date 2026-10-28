/**
 * The onboarding store (docs/PLAN.md 4.3, 6.2). Writes go through the user's own client, so RLS
 * and the column grants decide what each user may change (5.2). There is no job here: nothing is
 * collected for a draft, and collection (M3) only picks confirmed products of entitled accounts.
 */

export type TermIntent = "problem" | "category" | "alternative" | "competitor";

export interface ProductDraft {
  name: string;
  oneLiner: string;
  description: string;
  audience: string;
  competitors: { name: string; domain: string | null }[];
  terms: { term: string; intent: TermIntent }[];
  subreddits: string[];
}

export interface OwnedProduct {
  id: string;
  status: string;
}

export interface OnboardingStore {
  /** The owner's product, if any (one per owner, D9). */
  findProduct(userId: string): Promise<OwnedProduct | null>;
  /** Create the owner's product as a draft. Null when the owner already has one (D9). */
  createDraftProduct(userId: string, fields: { url: string; name: string }): Promise<string | null>;
  /**
   * Write a draft onto the owner's draft product: its fields, all its search terms, and its
   * competitors with origin "draft" (ones the owner added stay).
   */
  saveDraft(productId: string, url: string, draft: ProductDraft): Promise<void>;
}

import type { RawDraft } from "./draft";
import type {
  CompetitorOrigin,
  OnboardingStore,
  OwnedProduct,
  ProductDraft,
  ReviewEdits,
  ReviewProduct,
} from "./ports";

/**
 * In-memory doubles for onboarding: for tests, and the canned draft of the E2E fake services, which
 * only a local dev server honors (./e2e-services.ts).
 */

export function rawDraft(over: Partial<RawDraft> = {}): RawDraft {
  return {
    name: "Invoice Pal",
    one_liner: "Invoices that get paid on time.",
    description: "Invoice Pal sends invoices and chases late clients for freelancers.",
    audience: "Freelancers and small studios who bill clients.",
    competitors: [
      { name: "Ledgerly", domain: "ledgerly.example" },
      { name: "Billwise", domain: null },
    ],
    terms: Array.from({ length: 24 }, (_, i) => ({
      term: `how do I get clients to pay invoice ${i}`,
      intent: "problem" as const,
    })),
    subreddits: ["freelance", "smallbusiness"],
    ...over,
  };
}

export interface FakeProduct extends ReviewProduct {
  ownerId: string;
  confirmedAt: Date | null;
}

/** Mirrors the onboarding migration: one product per owner, competitors unique by name. */
export class FakeOnboardingStore implements OnboardingStore {
  readonly products = new Map<string, FakeProduct>();
  private next = 1;

  addProduct(ownerId: string, fields: Partial<FakeProduct> = {}): FakeProduct {
    const product: FakeProduct = {
      id: `product-${this.next++}`,
      ownerId,
      status: "draft",
      confirmedAt: null,
      url: "https://myproduct.example/",
      name: "Existing",
      oneLiner: "",
      description: "",
      audience: "",
      relevanceThreshold: 60,
      subreddits: [],
      terms: [],
      competitors: [],
      ...fields,
    };
    this.products.set(product.id, product);
    return product;
  }

  ownedBy(ownerId: string): FakeProduct | undefined {
    return [...this.products.values()].find((p) => p.ownerId === ownerId);
  }

  private draftProduct(productId: string): FakeProduct {
    const p = this.products.get(productId);
    if (!p || p.status !== "draft") throw new Error("not a draft");
    return p;
  }

  async findProduct(userId: string): Promise<OwnedProduct | null> {
    const p = this.ownedBy(userId);
    return p ? { id: p.id, status: p.status } : null;
  }

  async createDraftProduct(userId: string, fields: { url: string; name: string }) {
    if (this.ownedBy(userId)) return null;
    return this.addProduct(userId, fields).id;
  }

  async saveDraft(productId: string, url: string, draft: ProductDraft) {
    const p = this.draftProduct(productId);
    Object.assign(p, {
      url,
      name: draft.name,
      oneLiner: draft.oneLiner,
      description: draft.description,
      audience: draft.audience,
      subreddits: [...draft.subreddits],
      terms: [...draft.terms],
    });
    const kept = p.competitors.filter((c) => c.origin !== "draft");
    const taken = new Set(kept.map((c) => c.name));
    p.competitors = [
      ...kept,
      ...draft.competitors
        .filter((c) => !taken.has(c.name))
        .map((c) => ({ ...c, aliases: [], origin: "draft" as const })),
    ];
  }

  async loadReview(userId: string): Promise<ReviewProduct | null> {
    const p = this.ownedBy(userId);
    if (!p) return null;
    const review: Partial<FakeProduct> = structuredClone(p);
    delete review.ownerId;
    delete review.confirmedAt;
    return review as ReviewProduct;
  }

  async saveReview(productId: string, edits: ReviewEdits) {
    const p = this.draftProduct(productId);
    const origins = new Map<string, CompetitorOrigin>(p.competitors.map((c) => [c.name, c.origin]));
    Object.assign(p, structuredClone(edits), {
      competitors: edits.competitors.map((c) => ({ ...c, origin: origins.get(c.name) ?? "user" })),
    });
  }

  async confirmProduct(productId: string, now: Date) {
    const p = this.products.get(productId);
    if (!p || p.status !== "draft") return false;
    p.status = "active";
    p.confirmedAt = now;
    return true;
  }
}

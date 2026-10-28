import type { RawDraft } from "./draft";
import type { OnboardingStore, OwnedProduct, ProductDraft } from "./ports";

/** In-memory test doubles for onboarding. Test code only. */

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

export interface FakeProduct {
  id: string;
  ownerId: string;
  url: string;
  name: string;
  status: string;
  confirmedAt: Date | null;
  draft: ProductDraft | null;
  terms: ProductDraft["terms"];
  competitors: { name: string; domain: string | null; origin: "user" | "draft" | "discovered" }[];
}

/** Mirrors the onboarding migration: one product per owner, competitors unique by name. */
export class FakeOnboardingStore implements OnboardingStore {
  readonly products = new Map<string, FakeProduct>();
  private next = 1;

  addProduct(ownerId: string, fields: Partial<FakeProduct> = {}): FakeProduct {
    const product: FakeProduct = {
      id: `product-${this.next++}`,
      ownerId,
      url: "https://myproduct.example/",
      name: "Existing",
      status: "draft",
      confirmedAt: null,
      draft: null,
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

  async findProduct(userId: string): Promise<OwnedProduct | null> {
    const p = this.ownedBy(userId);
    return p ? { id: p.id, status: p.status } : null;
  }

  async createDraftProduct(userId: string, fields: { url: string; name: string }) {
    if (this.ownedBy(userId)) return null;
    return this.addProduct(userId, fields).id;
  }

  async saveDraft(productId: string, url: string, draft: ProductDraft) {
    const p = this.products.get(productId);
    if (!p) throw new Error("no such product");
    p.url = url;
    p.name = draft.name;
    p.draft = draft;
    p.terms = [...draft.terms];
    const kept = p.competitors.filter((c) => c.origin !== "draft");
    const taken = new Set(kept.map((c) => c.name));
    p.competitors = [
      ...kept,
      ...draft.competitors
        .filter((c) => !taken.has(c.name))
        .map((c) => ({ ...c, origin: "draft" as const })),
    ];
  }
}

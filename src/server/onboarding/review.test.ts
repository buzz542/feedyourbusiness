import { describe, expect, it } from "vitest";
import { FakeOnboardingStore, type FakeProduct } from "./fakes";
import { MAX_COMPETITORS, MAX_TERMS, submitReview } from "./review";

/** The review and confirm steps (docs/PLAN.md 4.3, steps 4 and 5), with an in-memory store. */

const USER = "user-1";
const NOW = new Date("2026-11-18T10:00:00Z");

function draftProduct(store: FakeOnboardingStore, over: Partial<FakeProduct> = {}) {
  return store.addProduct(USER, {
    url: "https://myproduct.example/",
    name: "Invoice Pal",
    oneLiner: "Invoices that get paid.",
    terms: [{ term: "invoice app for freelancers", intent: "category" }],
    competitors: [
      { name: "Ledgerly", domain: "ledgerly.example", aliases: [], origin: "draft" },
      { name: "Mine", domain: null, aliases: [], origin: "user" },
    ],
    ...over,
  });
}

interface FormFields {
  url: string;
  name: string;
  one_liner: string;
  description: string;
  audience: string;
  relevance_threshold: string;
  terms: unknown;
  competitors: unknown;
  subreddits: unknown;
}

function form(over: Partial<FormFields> = {}): FormData {
  const fields: FormFields = {
    url: "https://myproduct.example/app",
    name: "Invoice Pal",
    one_liner: "Invoices that get paid on time.",
    description: "Sends invoices and chases late clients.",
    audience: "Freelancers.",
    relevance_threshold: "70",
    terms: [
      { term: "looking for an invoice app", intent: "category" },
      { term: "alternative to Ledgerly", intent: "alternative" },
    ],
    competitors: [
      {
        name: "Ledgerly",
        domain: "https://www.Ledgerly.example/pricing",
        aliases: ["Ledgerly app"],
      },
      { name: "Paperbill", domain: "", aliases: [] },
    ],
    subreddits: ["freelance", "r/smallbusiness"],
    ...over,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(fields))
    data.set(key, typeof value === "string" ? value : JSON.stringify(value));
  return data;
}

describe("saving the review", () => {
  it("persists every edited field, terms and competitors", async () => {
    const store = new FakeOnboardingStore();
    const product = draftProduct(store);
    expect(await submitReview(store, USER, form(), "save", NOW)).toEqual({
      kind: "saved",
      leftOut: [],
    });
    expect(product).toMatchObject({
      status: "draft",
      url: "https://myproduct.example/app",
      oneLiner: "Invoices that get paid on time.",
      description: "Sends invoices and chases late clients.",
      audience: "Freelancers.",
      relevanceThreshold: 70,
      subreddits: ["freelance", "smallbusiness"],
      terms: [
        { term: "looking for an invoice app", intent: "category" },
        { term: "alternative to Ledgerly", intent: "alternative" },
      ],
    });
    // A kept name keeps its origin; a new one is the owner's. Removed ones go.
    expect(product.competitors).toEqual([
      { name: "Ledgerly", domain: "ledgerly.example", aliases: ["Ledgerly app"], origin: "draft" },
      { name: "Paperbill", domain: null, aliases: [], origin: "user" },
    ]);
  });

  it("leaves out a sensitive subreddit the owner typed, and says which (2.3.7)", async () => {
    const store = new FakeOnboardingStore();
    const product = draftProduct(store);
    const result = await submitReview(
      store,
      USER,
      form({ subreddits: ["freelance", "r/depression", "Christianity"] }),
      "save",
      NOW,
    );
    expect(result).toEqual({ kind: "saved", leftOut: ["depression", "Christianity"] });
    expect(product.subreddits).toEqual(["freelance"]);
  });

  it("drops repeated terms and competitors, ignoring case", async () => {
    const store = new FakeOnboardingStore();
    const product = draftProduct(store);
    await submitReview(
      store,
      USER,
      form({
        terms: [
          { term: "Invoice app", intent: "category" },
          { term: "invoice  app", intent: "problem" },
        ],
        competitors: [
          { name: "Ledgerly", domain: "", aliases: [] },
          { name: "ledgerly", domain: "", aliases: [] },
        ],
      }),
      "save",
      NOW,
    );
    expect(product.terms).toEqual([{ term: "Invoice app", intent: "category" }]);
    expect(product.competitors.map((c) => c.name)).toEqual(["Ledgerly"]);
  });

  it.each([
    ["an empty name", { name: "  " }, "name"],
    ["a URL that is not a web address", { url: "nope" }, "url"],
    ["a threshold below 40", { relevance_threshold: "39" }, "relevance_threshold"],
    ["a threshold above 95", { relevance_threshold: "96" }, "relevance_threshold"],
    ["a one-liner over 160 characters", { one_liner: "x".repeat(161) }, "one_liner"],
    [
      `more than ${MAX_TERMS} terms`,
      {
        terms: Array.from({ length: MAX_TERMS + 1 }, (_, i) => ({
          term: `t${i}x`,
          intent: "problem",
        })),
      },
      "terms",
    ],
    [
      "a term over 60 characters",
      { terms: [{ term: "x".repeat(61), intent: "problem" }] },
      "terms",
    ],
    ["an unknown intent", { terms: [{ term: "abc", intent: "spam" }] }, "terms"],
    [
      `more than ${MAX_COMPETITORS} competitors`,
      {
        competitors: Array.from({ length: MAX_COMPETITORS + 1 }, (_, i) => ({
          name: `C${i}`,
          domain: "",
          aliases: [],
        })),
      },
      "competitors",
    ],
    [
      "a competitor domain that is not a domain",
      { competitors: [{ name: "Odd", domain: "not a domain", aliases: [] }] },
      "competitors",
    ],
    [
      "an alias over 80 characters",
      { competitors: [{ name: "Odd", domain: "", aliases: ["x".repeat(81)] }] },
      "competitors",
    ],
    ["a malformed subreddit", { subreddits: ["bad name"] }, "subreddits"],
    [
      "more than 10 subreddits",
      { subreddits: Array.from({ length: 11 }, (_, i) => `sub${i}`) },
      "subreddits",
    ],
    ["a list that is not JSON", { terms: "{not json" }, "terms"],
  ])("refuses %s and saves nothing", async (_label, over, field) => {
    const store = new FakeOnboardingStore();
    const product = draftProduct(store);
    const before = structuredClone(product);
    const result = await submitReview(store, USER, form(over as Partial<FormFields>), "save", NOW);
    expect(result).toEqual({ kind: "invalid", fields: [field] });
    expect(product).toEqual(before);
  });

  it("finds only the signed-in owner's product", async () => {
    const store = new FakeOnboardingStore();
    const other = store.addProduct("someone-else");
    expect(await submitReview(store, USER, form(), "save", NOW)).toEqual({ kind: "no_product" });
    expect(other.name).toBe("Existing");
  });
});

describe("confirming", () => {
  it("saves the edits, then sets the product active with confirmed_at", async () => {
    const store = new FakeOnboardingStore();
    const product = draftProduct(store);
    expect(
      await submitReview(store, USER, form({ name: "Invoice Pal 2" }), "confirm", NOW),
    ).toEqual({ kind: "confirmed", leftOut: [] });
    expect(product).toMatchObject({ status: "active", confirmedAt: NOW, name: "Invoice Pal 2" });
  });

  it("needs at least one search term", async () => {
    const store = new FakeOnboardingStore();
    const product = draftProduct(store);
    expect(await submitReview(store, USER, form({ terms: [] }), "confirm", NOW)).toEqual({
      kind: "needs_terms",
    });
    expect(product.status).toBe("draft");
  });

  it("changes nothing once the product is confirmed: that is Settings' job", async () => {
    const store = new FakeOnboardingStore();
    const product = draftProduct(store, { status: "active", confirmedAt: NOW });
    const before = structuredClone(product);
    for (const intent of ["save", "confirm"] as const)
      expect(await submitReview(store, USER, form({ name: "Changed" }), intent, NOW)).toEqual({
        kind: "already_confirmed",
      });
    expect(product).toEqual(before);
  });
});

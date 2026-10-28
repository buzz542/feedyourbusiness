import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DATA_NOT_INSTRUCTIONS_RULE, NEVER_INFER_RULE } from "@/server/llm/rules";
import {
  DRAFT_SYSTEM,
  DraftSchema,
  draftInput,
  normalizeDraft,
  normalizeProductUrl,
} from "./draft";
import { rawDraft } from "./fakes";

/** The onboarding draft (docs/PLAN.md 8.3): what we send, and how the answer is cleaned up. */

describe("normalizeProductUrl", () => {
  it.each([
    ["myproduct.example", "https://myproduct.example/"],
    [
      "  https://myproduct.example/pricing?plan=pro#top ",
      "https://myproduct.example/pricing?plan=pro",
    ],
    ["http://myproduct.example", "https://myproduct.example/"],
    ["HTTPS://MyProduct.Example/App", "https://myproduct.example/App"],
  ])("reads %j as %s", (raw, url) => {
    expect(normalizeProductUrl(raw)).toBe(url);
  });

  it.each([
    "",
    "not a url",
    "ftp://myproduct.example",
    "https://user:pass@myproduct.example/",
    "https://localhost/",
    "javascript:alert(1)",
    `https://myproduct.example/${"a".repeat(2050)}`,
  ])("refuses %j", (raw) => {
    expect(normalizeProductUrl(raw)).toBeNull();
  });
});

describe("the draft prompt", () => {
  it("carries the never-infer rule and treats the page as data", () => {
    expect(DRAFT_SYSTEM).toContain(NEVER_INFER_RULE);
    expect(DRAFT_SYSTEM).toContain(DATA_NOT_INSTRUCTIONS_RULE);
  });

  it("asks for phrases people write, with alternative-to terms when there are competitors", () => {
    expect(DRAFT_SYSTEM).toMatch(/the way people write/i);
    expect(DRAFT_SYSTEM).toContain("alternative to");
    expect(DRAFT_SYSTEM).toMatch(/3 to 6/);
  });

  it("never asks for reply text (D8)", () => {
    expect(DRAFT_SYSTEM).not.toMatch(/\b(reply|replies|respond|response)\b/i);
  });

  it("sends the URL and the page text, or the maker's description, as the user message", () => {
    const page = draftInput("https://myproduct.example/", { pageText: "Hello page" });
    expect(page).toContain("https://myproduct.example/");
    expect(page).toContain("<page_text>\nHello page\n</page_text>");
    const described = draftInput("https://myproduct.example/", { description: "We do X" });
    expect(described).toContain("<maker_description>\nWe do X\n</maker_description>");
  });
});

describe("DraftSchema", () => {
  it("has no property that names a sensitive trait (8.2 guard)", () => {
    const banned =
      /health|medical|religio|politic|sexual|gender|race|ethnic|age|disab|pregnan|union|crime|nationality|immigration/i;
    const names: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const properties = (node as { properties?: Record<string, unknown> }).properties;
      if (properties) names.push(...Object.keys(properties));
      for (const value of Object.values(node)) walk(value);
    };
    walk(z.toJSONSchema(DraftSchema));
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => banned.test(n))).toEqual([]);
  });

  it("takes 20 to 30 terms and at most 8 competitors and 10 subreddits", () => {
    expect(DraftSchema.safeParse(rawDraft()).success).toBe(true);
    const terms = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ term: `term ${i}`, intent: "problem" as const }));
    expect(DraftSchema.safeParse(rawDraft({ terms: terms(19) })).success).toBe(false);
    expect(DraftSchema.safeParse(rawDraft({ terms: terms(31) })).success).toBe(false);
    const competitors = Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, domain: null }));
    expect(DraftSchema.safeParse(rawDraft({ competitors })).success).toBe(false);
  });
});

describe("normalizeDraft", () => {
  const url = "https://www.myproduct.example/";

  it("keeps a clean draft as it is", () => {
    const draft = normalizeDraft(rawDraft(), url);
    expect(draft.name).toBe("Invoice Pal");
    expect(draft.oneLiner).toBe("Invoices that get paid on time.");
    expect(draft.terms).toHaveLength(24);
    expect(draft.competitors).toEqual([
      { name: "Ledgerly", domain: "ledgerly.example" },
      { name: "Billwise", domain: null },
    ]);
  });

  it("drops suggested subreddits on the sensitive-community list (2.3.7, planted)", () => {
    const draft = normalizeDraft(
      rawDraft({ subreddits: ["SaaS", "depression", "freelance", "politics", "exmuslim", "lgbt"] }),
      url,
    );
    expect(draft.subreddits).toEqual(["SaaS", "freelance"]);
  });

  it("strips r/ prefixes, drops malformed and repeated subreddits", () => {
    const draft = normalizeDraft(
      rawDraft({ subreddits: ["r/SaaS", "saas", "/r/startups", "bad name", "u_someone"] }),
      url,
    );
    expect(draft.subreddits).toEqual(["SaaS", "startups"]);
  });

  it("dedupes terms without regard to case or spacing, and drops ones too short or long", () => {
    const draft = normalizeDraft(
      rawDraft({
        terms: [
          { term: "Looking for an invoice app", intent: "category" },
          { term: "looking  for an invoice app ", intent: "problem" },
          { term: "x", intent: "problem" },
          { term: "a".repeat(61), intent: "problem" },
          { term: "alternative to Ledgerly", intent: "alternative" },
        ],
      }),
      url,
    );
    expect(draft.terms).toEqual([
      { term: "Looking for an invoice app", intent: "category" },
      { term: "alternative to Ledgerly", intent: "alternative" },
    ]);
  });

  it("cleans competitor domains, and drops repeats and the product itself", () => {
    const draft = normalizeDraft(
      rawDraft({
        competitors: [
          { name: "Ledgerly", domain: "https://www.Ledgerly.example/pricing" },
          { name: "ledgerly", domain: null },
          { name: "Invoice Pal", domain: null },
          { name: "Selfie", domain: "myproduct.example" },
          { name: "Odd", domain: "not a domain" },
        ],
      }),
      url,
    );
    expect(draft.competitors).toEqual([
      { name: "Ledgerly", domain: "ledgerly.example" },
      { name: "Odd", domain: null },
    ]);
  });

  it("writes no em dashes into the fields the user will see", () => {
    const draft = normalizeDraft(
      rawDraft({
        one_liner: "Invoices — paid on time",
        description: "Fast—and simple. Pages 1–3.",
        terms: [
          ...rawDraft().terms.slice(0, 20),
          { term: "invoice app — freelancers", intent: "category" },
        ],
      }),
      url,
    );
    const text = JSON.stringify(draft);
    expect(text).not.toMatch(/[—–]/);
    expect(draft.oneLiner).toBe("Invoices, paid on time");
    expect(draft.description).toBe("Fast, and simple. Pages 1-3.");
  });
});

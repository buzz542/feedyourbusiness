import { describe, expect, it } from "vitest";
import { applyEdits, parseEdits, type ReviewStore, type ReviewSnapshot } from "./review";

/** "Here's what we found" (docs/PLAN.md 4.3 steps 4 and 5): edits under "Change something". */

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  const base = {
    name: "Acme",
    one_liner: "Invoices from receipts",
    description: "Acme turns receipts into invoices.",
    audience: "Freelancers",
    relevance_threshold: "60",
    terms: "how do I chase an invoice\nalternative to Rival",
    competitors: "Rival, rival.example\nOther Tool",
    subreddits: "freelance, r/smallbusiness",
  };
  for (const [k, v] of Object.entries({ ...base, ...fields })) data.set(k, v);
  return data;
};

describe("parseEdits", () => {
  it("reads every field", () => {
    const out = parseEdits(form({}));
    expect(out).toEqual({
      ok: true,
      edits: {
        profile: {
          name: "Acme",
          one_liner: "Invoices from receipts",
          description: "Acme turns receipts into invoices.",
          audience: "Freelancers",
          relevance_threshold: 60,
          subreddits: ["freelance", "smallbusiness"],
        },
        terms: ["how do I chase an invoice", "alternative to Rival"],
        competitors: [
          { name: "Rival", domain: "rival.example" },
          { name: "Other Tool", domain: null },
        ],
      },
    });
  });

  it("refuses a sensitive subreddit the user adds, with a message (planted)", () => {
    const out = parseEdits(form({ subreddits: "freelance, depression" }));
    expect(out).toEqual({
      ok: false,
      errors: { subreddits: "We don't search r/depression: it is about a sensitive topic." },
    });
  });

  it("refuses a user's profile as a subreddit (planted)", () => {
    const out = parseEdits(form({ subreddits: "u_someone" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.subreddits).toMatch(/profile/);
  });

  it.each([
    ["terms", "follow @someone"],
    ["terms", "email me at a@example.com"],
    ["competitors", "x.com/someone"],
  ])("refuses a handle, email or link in %s (planted)", (field, value) => {
    const out = parseEdits(form({ [field]: value }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(Object.keys(out.errors)).toEqual([field]);
  });

  it("keeps the limits: 40 terms, 20 competitors, 10 subreddits, threshold 40 to 95", () => {
    const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
    expect(parseEdits(form({ terms: many(41, (i) => `term ${i}`).join("\n") })).ok).toBe(false);
    expect(parseEdits(form({ terms: many(40, (i) => `term ${i}`).join("\n") })).ok).toBe(true);
    expect(parseEdits(form({ competitors: many(21, (i) => `Tool ${i}`).join("\n") })).ok).toBe(
      false,
    );
    expect(parseEdits(form({ subreddits: many(11, (i) => `sub${i}`).join(",") })).ok).toBe(false);
    expect(parseEdits(form({ relevance_threshold: "39" })).ok).toBe(false);
    expect(parseEdits(form({ relevance_threshold: "96" })).ok).toBe(false);
    expect(parseEdits(form({ relevance_threshold: "95" })).ok).toBe(true);
  });

  it("refuses an empty name and drops blank lines and duplicates", () => {
    expect(parseEdits(form({ name: "  " })).ok).toBe(false);
    const out = parseEdits(form({ terms: "a term\n\nA TERM\nanother term" }));
    expect(out.ok && out.edits.terms).toEqual(["a term", "another term"]);
  });
});

class FakeReviewStore implements ReviewStore {
  calls: string[] = [];
  async updateProfile() {
    this.calls.push("profile");
  }
  async addTerms(terms: string[]) {
    this.calls.push(`add terms ${terms.join("|")}`);
  }
  async removeTerms(ids: string[]) {
    this.calls.push(`remove terms ${ids.join("|")}`);
  }
  async addCompetitors(c: { name: string; domain: string | null }[]) {
    this.calls.push(`add rivals ${c.map((x) => `${x.name}:${x.domain ?? ""}`).join("|")}`);
  }
  async updateCompetitorDomain(id: string, domain: string | null) {
    this.calls.push(`domain ${id}:${domain ?? ""}`);
  }
  async removeCompetitors(ids: string[]) {
    this.calls.push(`remove rivals ${ids.join("|")}`);
  }
}

describe("applyEdits", () => {
  const snapshot: ReviewSnapshot = {
    terms: [
      { id: "t1", term: "how do I chase an invoice" },
      { id: "t2", term: "old term" },
    ],
    competitors: [
      { id: "c1", name: "Rival", domain: null },
      { id: "c2", name: "Gone Tool", domain: null },
    ],
  };

  it("adds and removes only what changed, ignoring case, and keeps a rival's aliases", async () => {
    const parsed = parseEdits(
      form({
        terms: "How do I chase an invoice\nnew term",
        competitors: "rival, rival.example\nNew Tool",
      }),
    );
    if (!parsed.ok) throw new Error("expected valid edits");
    const store = new FakeReviewStore();
    await applyEdits(store, snapshot, parsed.edits);
    expect(store.calls).toEqual([
      "profile",
      "remove terms t2",
      "add terms new term",
      "remove rivals c2",
      "domain c1:rival.example",
      "add rivals New Tool:",
    ]);
  });
});

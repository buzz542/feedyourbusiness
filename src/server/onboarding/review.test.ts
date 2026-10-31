import { describe, expect, it } from "vitest";
import { parseEdits } from "./review";

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

  it.each([
    ["a platform", "Reddit, reddit.com"],
    ["a publishing site", "Jane, jane.substack.com"],
    ["a Bluesky handle", "Jane, jane.bsky.social"],
  ])("refuses %s as a competitor's domain, with a message (planted)", (_, line) => {
    const out = parseEdits(form({ competitors: line }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.competitors).toBeTruthy();
  });

  it.each(["one_liner", "description", "audience"])(
    "refuses a handle, email or link in %s (planted)",
    (field) => {
      for (const value of ["Made by @someone", "Write to a@example.com", "See x.com/someone"]) {
        const out = parseEdits(form({ [field]: value }));
        expect(out.ok, value).toBe(false);
      }
    },
  );

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

describe("parseEdits, after review", () => {
  it("keeps a comma inside a competitor's name, and takes a pasted link's domain", () => {
    const out = parseEdits(
      form({ competitors: "Acme, Inc.\nRival, https://rival.example/pricing" }),
    );
    expect(out.ok && out.edits.competitors).toEqual([
      { name: "Acme, Inc.", domain: null },
      { name: "Rival", domain: "rival.example" },
    ]);
  });

  it("needs at least one search term", () => {
    const out = parseEdits(form({ terms: "  \n " }));
    expect(out.ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  fromDraft,
  profileReducer,
  subredditProblem,
  termProblem,
  toProfileInput,
  type EditableProfile,
} from "./profile-state";

/** The review form's state (docs/PLAN.md 4.3, step 4): pure, so every edit is unit tested. */

const base: EditableProfile = fromDraft({
  name: "Invoicer",
  one_liner: "Invoices that chase themselves",
  description: "A small tool.",
  audience: "Freelancers",
  relevance_threshold: 60,
  subreddits: ["freelance"],
  terms: [
    { term: "chase invoice", intent: "problem" },
    { term: "alternative to Ledgerly", intent: "alternative" },
  ],
  competitors: [
    { id: "c1", name: "Ledgerly", domain: "ledgerly.example", aliases: ["Ledgerly app", "LDG"] },
  ],
});

describe("profileReducer", () => {
  it("edits text fields and the threshold", () => {
    let s = profileReducer(base, { type: "field", field: "name", value: "Invoicer Pro" });
    s = profileReducer(s, { type: "threshold", value: 75 });
    expect(s.name).toBe("Invoicer Pro");
    expect(s.relevance_threshold).toBe(75);
    expect(base.name).toBe("Invoicer");
  });

  it("adds a term as a problem term, squashed, and removes terms", () => {
    let s = profileReducer(base, { type: "addTerm", term: "  late   payment  " });
    expect(s.terms.at(-1)).toEqual({ term: "late payment", intent: "problem" });
    s = profileReducer(s, { type: "removeTerm", index: 0 });
    expect(s.terms.map((t) => t.term)).toEqual(["alternative to Ledgerly", "late payment"]);
  });

  it("adds, edits and removes competitors by key", () => {
    let s = profileReducer(base, { type: "addCompetitor" });
    const added = s.competitors.at(-1)!;
    expect(added).toMatchObject({ id: null, name: "", domain: "", aliases: "" });
    s = profileReducer(s, {
      type: "editCompetitor",
      key: added.key,
      patch: { name: "Paidly", domain: "paidly.example" },
    });
    expect(s.competitors.at(-1)).toMatchObject({ name: "Paidly", domain: "paidly.example" });
    s = profileReducer(s, { type: "removeCompetitor", key: s.competitors[0]!.key });
    expect(s.competitors.map((c) => c.name)).toEqual(["Paidly"]);
    expect(new Set(s.competitors.map((c) => c.key)).size).toBe(s.competitors.length);
  });

  it("adds and removes subreddits, without the r/ prefix", () => {
    let s = profileReducer(base, { type: "addSubreddit", name: "r/SaaS" });
    expect(s.subreddits).toEqual(["freelance", "SaaS"]);
    s = profileReducer(s, { type: "removeSubreddit", index: 0 });
    expect(s.subreddits).toEqual(["SaaS"]);
  });
});

describe("termProblem", () => {
  it.each([
    ["x", "Each term needs 2 to 60 characters."],
    ["y".repeat(61), "Each term needs 2 to 60 characters."],
    ["Chase  Invoice", "That term is already in the list."],
  ])("explains %j", (text, message) => {
    expect(termProblem(base.terms, text)).toBe(message);
  });

  it("stops at 40 terms", () => {
    const full = Array.from({ length: 40 }, (_, i) => ({
      term: `t ${i}`,
      intent: "problem" as const,
    }));
    expect(termProblem(full, "one more")).toBe("You can keep up to 40 terms. Remove one first.");
  });

  it("accepts a new term", () => {
    expect(termProblem(base.terms, "late payment")).toBeNull();
  });
});

describe("subredditProblem", () => {
  it.each([
    ["no spaces allowed", "Use the subreddit's name, like SaaS."],
    ["Freelance", "That subreddit is already in the list."],
    ["u_someone", "That is a person's profile, not a community."],
    [
      "r/depression",
      "AskedFor does not search communities about health, sexuality, religion, politics, ethnicity or similar topics.",
    ],
  ])("explains %j", (text, message) => {
    expect(subredditProblem(base.subreddits, text)).toBe(message);
  });

  it("stops at 10", () => {
    const full = Array.from({ length: 10 }, (_, i) => `sub${i}`);
    expect(subredditProblem(full, "SaaS")).toBe(
      "You can keep up to 10 subreddits. Remove one first.",
    );
  });
});

describe("toProfileInput", () => {
  it("sends what the server's parser expects", () => {
    expect(toProfileInput(base)).toEqual({
      name: "Invoicer",
      one_liner: "Invoices that chase themselves",
      description: "A small tool.",
      audience: "Freelancers",
      relevance_threshold: 60,
      subreddits: ["freelance"],
      terms: [
        { term: "chase invoice", intent: "problem" },
        { term: "alternative to Ledgerly", intent: "alternative" },
      ],
      competitors: [
        {
          id: "c1",
          name: "Ledgerly",
          domain: "ledgerly.example",
          aliases: ["Ledgerly app", "LDG"],
        },
      ],
    });
  });

  it("splits aliases on commas and sends an empty domain as null", () => {
    const s = profileReducer(base, {
      type: "editCompetitor",
      key: base.competitors[0]!.key,
      patch: { domain: " ", aliases: "One, Two ,, " },
    });
    expect(toProfileInput(s).competitors[0]).toMatchObject({
      domain: null,
      aliases: ["One", "Two"],
    });
  });
});

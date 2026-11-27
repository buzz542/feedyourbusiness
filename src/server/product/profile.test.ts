import { describe, expect, it } from "vitest";
import { BRAND_TERM_CAP, ALTERNATIVE_TERM_CAP, intentFor, planProfileSave } from "./profile";

/**
 * The product profile after setup (the founder's redesign brief, 27 Nov 2026): the owner reviews
 * and edits the name, website, one-liner, description, audience, search terms and minimum match.
 * The field rules are onboarding's (parseEdits); terms keep onboarding's caps on brand names (3)
 * and "alternative" phrases (4), so the edit can never add back what the draft was built to avoid.
 */

const current = {
  url: "https://shuttle.example/",
  terms: [
    { id: "t1", term: "airport transfer", intent: "category" },
    { id: "t2", term: "Rideo", intent: "competitor" },
    { id: "t3", term: "alternative to Rideo", intent: "alternative" },
  ],
  competitors: ["Rideo", "Taxora", "Sunny Cabs", "Transferly"],
};

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const values = {
    name: "Shuttler",
    url: "https://shuttle.example/",
    one_liner: "Compare airport transfer prices.",
    description: "Compare private airport transfers across Europe.",
    audience: "Travelers flying into European airports.",
    relevance_threshold: "50",
    terms: "airport transfer\nRideo\ntaxi from the airport",
    ...over,
  };
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("intentFor", () => {
  it("keeps a saved term's intent, ignoring case", () => {
    expect(intentFor("RIDEO", current.terms, current.competitors)).toBe("competitor");
  });

  it("reads a new term: a competitor's name alone, an alternative phrase, or a problem", () => {
    expect(intentFor("taxora", [], current.competitors)).toBe("competitor");
    expect(intentFor("Alternatives to Taxora", [], current.competitors)).toBe("alternative");
    expect(intentFor("Sunny Cabs alternative", [], current.competitors)).toBe("alternative");
    expect(intentFor("taxi from the airport", [], current.competitors)).toBe("problem");
  });
});

describe("planProfileSave", () => {
  it("saves the profile and works out which terms to remove and add", () => {
    const plan = planProfileSave(form(), current);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.profile).toEqual({
      name: "Shuttler",
      url: "https://shuttle.example/",
      one_liner: "Compare airport transfer prices.",
      description: "Compare private airport transfers across Europe.",
      audience: "Travelers flying into European airports.",
      relevance_threshold: 50,
    });
    // The whole list, each with its intent: the database removes, renames and adds in one go.
    expect(plan.terms).toEqual([
      { term: "airport transfer", intent: "category" },
      { term: "Rideo", intent: "competitor" },
      { term: "taxi from the airport", intent: "problem" },
    ]);
  });

  it("keeps onboarding's caps: at most 3 brand names alone and 4 alternative phrases", () => {
    expect(BRAND_TERM_CAP).toBe(3);
    expect(ALTERNATIVE_TERM_CAP).toBe(4);
    const brands = planProfileSave(
      form({ terms: "Rideo\nTaxora\nSunny Cabs\nTransferly\nairport transfer" }),
      current,
    );
    expect(brands).toEqual({
      ok: false,
      errors: { terms: "Keep it to 3 terms that are only a competitor's name." },
    });
    const alternatives = planProfileSave(
      form({
        terms: [
          "alternative to Rideo",
          "alternative to Taxora",
          "Sunny Cabs alternative",
          "alternatives to Transferly",
          "cheaper alternative to a taxi",
        ].join("\n"),
      }),
      current,
    );
    expect(alternatives).toEqual({
      ok: false,
      errors: { terms: 'Keep it to 4 "alternative to" terms.' },
    });
  });

  it("refuses a website that is not the product's own https address", () => {
    for (const url of [
      "http://shuttle.example/",
      "https://www.reddit.com/r/travel",
      "https://user:pw@shuttle.example/",
      "https://intranet.local/",
      "https://localhost/",
      "not a url",
    ]) {
      const plan = planProfileSave(form({ url }), current);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.errors.url).toBe("Use your product's own https address.");
    }
  });

  it("lets the website be left as it is when none was saved, but not cleared", () => {
    expect(planProfileSave(form({ url: "" }), { ...current, url: null }).ok).toBe(true);
    const cleared = planProfileSave(form({ url: "" }), current);
    expect(cleared.ok).toBe(false);
  });

  it("uses onboarding's field rules, such as the 40 to 95 minimum match", () => {
    const plan = planProfileSave(form({ relevance_threshold: "20", name: "" }), current);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.errors.relevance_threshold).toBe("Pick a match threshold from 40 to 95.");
      expect(plan.errors.name).toBeDefined();
    }
  });
});

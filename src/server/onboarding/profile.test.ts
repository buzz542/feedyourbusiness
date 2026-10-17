import { describe, expect, it, vi } from "vitest";
import { confirmProfile, parseProfile, saveProfile, type ProfileStore } from "./profile";

/** The onboarding review step (docs/PLAN.md 4.3): every field editable, then confirm. */

const RIVAL_ID = "00000000-0000-4000-8000-00000000c001";

const input = (over: Record<string, unknown> = {}) => ({
  name: "  Invoicer ",
  one_liner: "Invoices that chase themselves",
  description: "A small tool for freelancers.",
  audience: "Freelancers",
  relevance_threshold: 60,
  terms: [
    { term: "how do I  chase an invoice", intent: "problem" },
    { term: "alternative to Ledgerly", intent: "alternative" },
  ],
  competitors: [
    {
      id: RIVAL_ID,
      name: "Ledgerly",
      domain: "https://www.ledgerly.example/",
      aliases: ["Ledgerly app"],
    },
    { id: null, name: "Paidly", domain: "", aliases: [] },
  ],
  subreddits: ["r/freelance", "SaaS"],
  ...over,
});

function store(confirmed: "confirmed" | "refused" = "confirmed") {
  return {
    save: vi.fn<ProfileStore["save"]>(async () => {}),
    confirm: vi.fn<ProfileStore["confirm"]>(async () => confirmed),
  };
}

describe("parseProfile", () => {
  it("trims, squashes and normalizes every field", () => {
    const parsed = parseProfile(input());
    expect(parsed).toEqual({
      ok: true,
      profile: {
        name: "Invoicer",
        one_liner: "Invoices that chase themselves",
        description: "A small tool for freelancers.",
        audience: "Freelancers",
        relevance_threshold: 60,
        terms: [
          { term: "how do I chase an invoice", intent: "problem" },
          { term: "alternative to Ledgerly", intent: "alternative" },
        ],
        competitors: [
          { id: RIVAL_ID, name: "Ledgerly", domain: "ledgerly.example", aliases: ["Ledgerly app"] },
          { id: null, name: "Paidly", domain: null, aliases: [] },
        ],
        subreddits: ["freelance", "SaaS"],
      },
    });
  });

  it.each([
    [{ name: "   " }, "name", "Enter your product's name."],
    [{ relevance_threshold: 30 }, "relevance_threshold", "Choose a number from 40 to 95."],
    [{ relevance_threshold: 96 }, "relevance_threshold", "Choose a number from 40 to 95."],
    [{ terms: [{ term: "a", intent: "problem" }] }, "terms", "Each term needs 2 to 60 characters."],
    [
      {
        terms: [
          { term: "Chase invoice", intent: "problem" },
          { term: "chase  invoice", intent: "category" },
        ],
      },
      "terms",
      'You have "chase invoice" twice.',
    ],
    [
      { terms: Array.from({ length: 41 }, (_, i) => ({ term: `term ${i}`, intent: "problem" })) },
      "terms",
      "Keep it to 40 terms.",
    ],
    [
      { competitors: [{ id: null, name: "Ledgerly", domain: "not a domain", aliases: [] }] },
      "competitors.0.domain",
      "Enter a domain like example.com, or leave it empty.",
    ],
    [
      {
        competitors: [
          { id: null, name: "Ledgerly", domain: null, aliases: [] },
          { id: null, name: "ledgerly", domain: null, aliases: [] },
        ],
      },
      "competitors.1.name",
      'You have "ledgerly" twice.',
    ],
    [{ subreddits: ["not valid!"] }, "subreddits", "r/not valid! is not a subreddit name."],
    [
      { subreddits: ["depression"] },
      "subreddits",
      "AskedFor does not search communities about health, sexuality, religion, politics, ethnicity or similar topics, so r/depression is left out.",
    ],
    [
      { subreddits: ["u_someone"] },
      "subreddits",
      "r/u_someone is a person's profile, not a community.",
    ],
  ])("explains a bad value: %j", (over, field, message) => {
    const parsed = parseProfile(input(over));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[field]).toBe(message);
  });

  it("refuses input that is not a profile at all", () => {
    expect(parseProfile(null)).toEqual({
      ok: false,
      errors: { form: "Something was missing. Reload the page and try again." },
    });
    expect(parseProfile({ ...input(), terms: "nope" }).ok).toBe(false);
  });
});

describe("saveProfile", () => {
  it("saves the parsed profile for the product", async () => {
    const s = store();
    expect(await saveProfile("p1", input(), { store: s })).toEqual({ ok: true });
    expect(s.save).toHaveBeenCalledWith("p1", expect.objectContaining({ name: "Invoicer" }));
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it("saves nothing when a field is wrong", async () => {
    const s = store();
    expect((await saveProfile("p1", input({ name: "" }), { store: s })).ok).toBe(false);
    expect(s.save).not.toHaveBeenCalled();
  });
});

describe("confirmProfile", () => {
  it("saves the edits, confirms, and records product_confirmed", async () => {
    const s = store();
    const confirmed = vi.fn(async () => {});
    expect(await confirmProfile("p1", input(), { store: s, onConfirmed: confirmed })).toEqual({
      ok: true,
    });
    expect(s.save).toHaveBeenCalled();
    expect(s.confirm).toHaveBeenCalledWith("p1");
    expect(confirmed).toHaveBeenCalledWith({ terms: 2, competitors: 2 });
    expect(s.save.mock.invocationCallOrder[0]!).toBeLessThan(
      s.confirm.mock.invocationCallOrder[0]!,
    );
  });

  it("needs at least one term", async () => {
    const s = store();
    const result = await confirmProfile("p1", input({ terms: [] }), {
      store: s,
      onConfirmed: vi.fn(),
    });
    expect(result).toEqual({ ok: false, errors: { terms: "Add at least one search term." } });
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it("explains when the database refuses (already confirmed, or no active term)", async () => {
    const confirmed = vi.fn();
    const result = await confirmProfile("p1", input(), {
      store: store("refused"),
      onConfirmed: confirmed,
    });
    expect(result).toEqual({
      ok: false,
      errors: { form: "This product could not be confirmed. Reload the page and try again." },
    });
    expect(confirmed).not.toHaveBeenCalled();
  });
});

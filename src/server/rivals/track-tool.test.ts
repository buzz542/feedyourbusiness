import { describe, expect, it } from "vitest";
import { trackTool, type TrackToolStore } from "./track-tool";

function fake(terms = 10) {
  const state = {
    competitors: ["Ledgerly"],
    terms: Array.from({ length: terms }, (_, i) => `t${i}`),
  };
  const store: TrackToolStore = {
    competitorNames: async () => state.competitors,
    termCount: async () => state.terms.length,
    addCompetitor: async (_p, name) => void state.competitors.push(name),
    addTerm: async (_p, term) => void state.terms.push(term),
  };
  return { store, state };
}

describe("track a discovered tool", () => {
  it("becomes a competitor and '<tool> alternative' is offered as a term", async () => {
    const { store, state } = fake();
    expect(await trackTool(store, "p", "Billwise")).toEqual({
      ok: true,
      term: "Billwise alternative",
    });
    expect(state.competitors).toContain("Billwise");
    expect(state.terms).toContain("Billwise alternative");
  });

  it("does not add a term past the 40-term limit", async () => {
    const { store, state } = fake(40);
    expect(await trackTool(store, "p", "Billwise")).toEqual({ ok: true, term: null });
    expect(state.terms).toHaveLength(40);
  });

  it("refuses a tool already tracked, in any case", async () => {
    const { store } = fake();
    expect(await trackTool(store, "p", "LEDGERLY")).toEqual({
      ok: false,
      reason: "already_tracked",
    });
  });

  it.each([
    "",
    "@someone",
    "u/someone",
    "https://x.test",
    "someone@example.test",
    "billwise.com",
    "x".repeat(61),
  ])("refuses %j", async (name) => {
    const { store, state } = fake();
    expect(await trackTool(store, "p", name)).toEqual({ ok: false, reason: "invalid" });
    expect(state.competitors).toEqual(["Ledgerly"]);
  });
});

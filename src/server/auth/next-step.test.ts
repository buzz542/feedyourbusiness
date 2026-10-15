import { describe, expect, it } from "vitest";
import { gateFor, nextStepFor, type AppState } from "./next-step";

const product = (status: "draft" | "active" | "paused") => ({ id: "p1", name: "Invoicer", status });
const state = (over: Partial<AppState> = {}): AppState => ({
  termsAccepted: true,
  product: product("active"),
  subscriptionStatus: "trialing",
  ...over,
});

describe("nextStepFor (docs/PLAN.md 4.2)", () => {
  it.each<[string, AppState, string]>([
    [
      "terms not accepted",
      state({ termsAccepted: false, product: null, subscriptionStatus: null }),
      "/app/welcome",
    ],
    ["terms not accepted, even when paying", state({ termsAccepted: false }), "/app/welcome"],
    ["no product", state({ product: null, subscriptionStatus: null }), "/app/onboarding"],
    [
      "draft product",
      state({ product: product("draft"), subscriptionStatus: null }),
      "/app/onboarding",
    ],
    ["draft product while subscribed", state({ product: product("draft") }), "/app/onboarding"],
    ["not entitled (never subscribed)", state({ subscriptionStatus: null }), "/app/billing"],
    ["not entitled (canceled)", state({ subscriptionStatus: "canceled" }), "/app/billing"],
    ["not entitled (incomplete)", state({ subscriptionStatus: "incomplete" }), "/app/billing"],
    [
      "past_due: fix the card, never a second checkout",
      state({ subscriptionStatus: "past_due" }),
      "/app/settings",
    ],
    ["unpaid: fix the card", state({ subscriptionStatus: "unpaid" }), "/app/settings"],
    ["paused subscription: settings", state({ subscriptionStatus: "paused" }), "/app/settings"],
    [
      "not entitled (incomplete_expired)",
      state({ subscriptionStatus: "incomplete_expired" }),
      "/app/billing",
    ],
    ["entitled (trialing)", state({ subscriptionStatus: "trialing" }), "/app/reply"],
    ["entitled (active)", state({ subscriptionStatus: "active" }), "/app/reply"],
    ["entitled with collection paused", state({ product: product("paused") }), "/app/reply"],
  ])("%s", (_name, s, path) => {
    expect(nextStepFor(s).path).toBe(path);
  });
});

describe("gateFor", () => {
  it("lets an entitled user see the data tabs and settings", () => {
    for (const page of ["reply", "rivals", "build", "settings"] as const)
      expect(gateFor(page, state())).toBeNull();
  });

  it("sends a non-entitled user from a data tab to their next step", () => {
    expect(gateFor("reply", state({ subscriptionStatus: null }))).toBe("/app/billing");
    expect(gateFor("rivals", state({ subscriptionStatus: "past_due" }))).toBe("/app/settings");
    expect(gateFor("build", state({ product: null }))).toBe("/app/onboarding");
  });

  it("asks for the confirmations before anything else", () => {
    for (const page of ["onboarding", "billing", "reply", "settings"] as const)
      expect(gateFor(page, state({ termsAccepted: false }))).toBe("/app/welcome");
  });

  it("shows the welcome step only until the terms are accepted", () => {
    expect(gateFor("welcome", state({ termsAccepted: false }))).toBeNull();
    expect(gateFor("welcome", state())).toBe("/app");
  });

  it("allows onboarding without a product or with a draft, not after confirming", () => {
    expect(gateFor("onboarding", state({ product: null }))).toBeNull();
    expect(gateFor("onboarding", state({ product: product("draft") }))).toBeNull();
    expect(gateFor("onboarding", state())).toBe("/app");
  });

  it("allows billing only with a confirmed product and no live subscription", () => {
    expect(gateFor("billing", state({ subscriptionStatus: null }))).toBeNull();
    expect(gateFor("billing", state({ subscriptionStatus: "canceled" }))).toBeNull();
    expect(gateFor("billing", state({ product: product("draft"), subscriptionStatus: null }))).toBe(
      "/app/onboarding",
    );
    expect(gateFor("billing", state())).toBe("/app");
    expect(gateFor("billing", state({ subscriptionStatus: "past_due" }))).toBe("/app");
  });

  it("lets settings open in any state after the confirmations", () => {
    expect(gateFor("settings", state({ product: null, subscriptionStatus: null }))).toBeNull();
    expect(gateFor("settings", state({ subscriptionStatus: "past_due" }))).toBeNull();
  });
});

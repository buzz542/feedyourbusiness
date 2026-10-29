import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OWN_SITE_ONLY, REFUSAL_MESSAGES } from "./messages";

describe("onboarding refusal messages", () => {
  it("say the plan's line for every link we will not read", () => {
    const plan = readFileSync("docs/PLAN.md", "utf8").replace(/\s+/g, " ");
    expect(plan).toContain(`"${OWN_SITE_ONLY}"`);
    for (const reason of ["platform", "third_party", "profile", "email", "handle"] as const) {
      expect(REFUSAL_MESSAGES[reason]).toBe(OWN_SITE_ONLY);
    }
  });

  it("have a message for every reason, and never name a platform", () => {
    for (const message of Object.values(REFUSAL_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/reddit|linkedin|github|product hunt|\bx\.com/i);
    }
  });
});

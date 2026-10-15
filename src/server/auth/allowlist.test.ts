import { describe, expect, it } from "vitest";
import { isSignInAllowed, parseAllowlist } from "./allowlist";

describe("pre-launch allowlist (docs/PLAN.md 12.10)", () => {
  it("parses comma-separated emails, trimmed and lowercased", () => {
    expect([...parseAllowlist(" Founder@Example.test, beta@example.test ,,")]).toEqual([
      "founder@example.test",
      "beta@example.test",
    ]);
  });

  it("allows listed emails in any case", () => {
    const env = { SIGNUP_ALLOWLIST: "founder@example.test" };
    expect(isSignInAllowed("FOUNDER@example.test ", env)).toBe(true);
  });

  it("refuses everyone else", () => {
    const env = { SIGNUP_ALLOWLIST: "founder@example.test" };
    expect(isSignInAllowed("stranger@example.test", env)).toBe(false);
    expect(isSignInAllowed("founder@example.test.evil", env)).toBe(false);
    expect(isSignInAllowed("", env)).toBe(false);
    expect(isSignInAllowed(null, env)).toBe(false);
  });

  it("fails closed: an unset or empty list lets nobody in", () => {
    expect(isSignInAllowed("founder@example.test", {})).toBe(false);
    expect(isSignInAllowed("founder@example.test", { SIGNUP_ALLOWLIST: " " })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseAllowlist } from "./allowlist";

/** Pre-launch access (docs/PLAN.md 12.10): only emails in SIGNUP_ALLOWLIST may sign in. */
describe("parseAllowlist", () => {
  it("matches emails case-insensitively, trimming spaces", () => {
    const allowed = parseAllowlist(" Founder@Example.test , friend@example.test,,");
    expect(allowed("founder@example.test")).toBe(true);
    expect(allowed("FRIEND@example.test ")).toBe(true);
    expect(allowed("stranger@example.test")).toBe(false);
  });

  it("is closed when the list is empty or unset: nobody gets in by accident", () => {
    for (const raw of [undefined, "", " , "]) {
      const allowed = parseAllowlist(raw);
      expect(allowed("founder@example.test")).toBe(false);
      expect(allowed("")).toBe(false);
    }
  });

  it("refuses a missing email and lookalikes", () => {
    const allowed = parseAllowlist("founder@example.test");
    expect(allowed(null)).toBe(false);
    expect(allowed(undefined)).toBe(false);
    expect(allowed("founder@example.test.evil")).toBe(false);
    expect(allowed("xfounder@example.test")).toBe(false);
  });
});

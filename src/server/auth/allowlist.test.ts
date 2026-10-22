import { describe, expect, it } from "vitest";
import { isAllowedEmail, parseAllowlist } from "./allowlist";

describe("signup allowlist", () => {
  const list = parseAllowlist(" Founder@Example.test, friend@example.test ,,");

  it("matches emails case-insensitively and trimmed", () => {
    expect(isAllowedEmail("founder@example.test", list)).toBe(true);
    expect(isAllowedEmail("  FRIEND@example.test ", list)).toBe(true);
  });

  it("refuses everyone else, including lookalikes", () => {
    expect(isAllowedEmail("stranger@example.test", list)).toBe(false);
    expect(isAllowedEmail("founder@example.test.evil", list)).toBe(false);
    expect(isAllowedEmail("xfounder@example.test", list)).toBe(false);
    expect(isAllowedEmail("", list)).toBe(false);
    expect(isAllowedEmail(null, list)).toBe(false);
  });

  it("an unset or empty list lets nobody in", () => {
    expect(isAllowedEmail("founder@example.test", parseAllowlist(undefined))).toBe(false);
    expect(isAllowedEmail("founder@example.test", parseAllowlist(""))).toBe(false);
  });
});

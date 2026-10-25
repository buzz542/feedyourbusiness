import { describe, expect, it } from "vitest";
import { isLaunched, robotsTxt, siteRobots } from "@/lib/launch";
import { isSignInAllowed } from "@/server/auth/allowlist";

/** The launch switch (docs/TASKS.md M9): noindex, robots and the allowlist change together. */
describe("launch switch", () => {
  const before = { SIGNUP_ALLOWLIST: "founder@example.test" };
  const after = { ...before, PUBLIC_LAUNCH: "true" };

  it("before launch: noindex, robots disallow everything, only the allowlist signs in", () => {
    expect(isLaunched(before)).toBe(false);
    expect(siteRobots(before)).toEqual({ index: false, follow: false });
    expect(robotsTxt(before)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(isSignInAllowed("founder@example.test", before)).toBe(true);
    expect(isSignInAllowed("stranger@example.test", before)).toBe(false);
  });

  it("after launch: all three change together", () => {
    expect(siteRobots(after)).toEqual({ index: true, follow: true });
    expect(robotsTxt(after)).toMatchObject({ rules: { allow: "/" } });
    expect(isSignInAllowed("stranger@example.test", after)).toBe(true);
  });

  it.each(["1", "yes", "TRUE", "", undefined])(
    "only the exact value true launches (%j)",
    (value) => {
      expect(isLaunched({ PUBLIC_LAUNCH: value })).toBe(false);
    },
  );

  it("app, admin and API paths stay out of search after launch", () => {
    expect(robotsTxt(after)).toMatchObject({
      rules: { disallow: expect.arrayContaining(["/app", "/admin", "/api"]) },
    });
  });
});

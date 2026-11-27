import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAllowlist } from "@/server/auth/allowlist";
import { isLaunchOpen, robotsMeta } from "./launch";

/**
 * The launch switch (docs/PLAN.md 12.10, M9; the founder, 20 Nov 2026): one variable, LAUNCH_OPEN,
 * opens sign-up to everyone, lets search engines in and drops the noindex tag. The three change
 * together or not at all.
 */

describe("isLaunchOpen", () => {
  it("is closed unless LAUNCH_OPEN is exactly true", () => {
    expect(isLaunchOpen({})).toBe(false);
    for (const value of ["", "1", "TRUE", "yes", "false", " true"])
      expect(isLaunchOpen({ LAUNCH_OPEN: value }), value).toBe(false);
    expect(isLaunchOpen({ LAUNCH_OPEN: "true" })).toBe(true);
  });
});

describe("the three change together", () => {
  it("closed: only the allowlist signs in, and search engines are kept out", () => {
    const env = { SIGNUP_ALLOWLIST: "me@example.test" };
    const allowed = loadAllowlist(env);
    expect(allowed("me@example.test")).toBe(true);
    expect(allowed("stranger@example.test")).toBe(false);
    expect(loadAllowlist({})("me@example.test")).toBe(false);
    expect(robotsMeta(env)).toEqual({ index: false, follow: false });
  });

  it("open: anyone with an email signs in, and the page can be indexed", () => {
    const env = { LAUNCH_OPEN: "true" };
    const allowed = loadAllowlist(env);
    expect(allowed("stranger@example.test")).toBe(true);
    expect(allowed("another.person@example.test")).toBe(true);
    expect(robotsMeta(env)).toEqual({ index: true, follow: true });
  });

  it("open, an email that is missing or not a string is still refused", () => {
    const allowed = loadAllowlist({ LAUNCH_OPEN: "true" });
    expect(allowed(null)).toBe(false);
    expect(allowed(undefined)).toBe(false);
    expect(allowed("")).toBe(false);
  });
});

describe("robots.txt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("disallows everything while closed", async () => {
    vi.stubEnv("LAUNCH_OPEN", "");
    const { default: robots } = await import("@/app/robots");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("allows the public pages and keeps the app, admin and api out once open", async () => {
    vi.stubEnv("LAUNCH_OPEN", "true");
    const { default: robots } = await import("@/app/robots");
    const rules = robots().rules as { userAgent: string; allow?: string; disallow?: string[] };
    expect(rules.userAgent).toBe("*");
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(expect.arrayContaining(["/app", "/admin", "/api"]));
  });
});

describe("the private beta sentence", () => {
  afterEach(() => vi.unstubAllEnvs());
  const sentence = "FeedYourBusiness is in private beta. Until launch, sign-in is by invitation.";

  it("shows on the landing and pricing pages while closed, and goes when open", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: Landing } = await import("@/app/(home)/page");
    const { default: Pricing } = await import("@/app/(marketing)/pricing/page");
    for (const Page of [Landing, Pricing]) {
      vi.stubEnv("LAUNCH_OPEN", "");
      expect(renderToStaticMarkup(createElement(Page))).toContain(sentence);
      vi.stubEnv("LAUNCH_OPEN", "true");
      expect(renderToStaticMarkup(createElement(Page))).not.toContain("private beta");
    }
  });
});

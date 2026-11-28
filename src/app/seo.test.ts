import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Search (the founder, 28 Nov 2026): the site is closed to search engines until the launch switch
 * is on, so the sitemap lists nothing while it is closed, and lists the public pages once it is open.
 * Nothing here turns the switch on.
 */
const PUBLIC = [
  "/",
  "/pricing",
  "/sources",
  "/terms",
  "/acceptable-use",
  "/privacy",
  "/cookies",
  "/remove-my-post",
];

describe("sitemap", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists nothing while the site is closed", async () => {
    vi.stubEnv("LAUNCH_OPEN", "");
    const { default: sitemap } = await import("./sitemap");
    expect(sitemap()).toEqual([]);
  });

  it("lists the public pages, on the site's own address, once it is open", async () => {
    vi.stubEnv("LAUNCH_OPEN", "true");
    const { default: sitemap } = await import("./sitemap");
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.sort()).toEqual(PUBLIC.map((p) => `https://feedyourbusiness.app${p}`).sort());
    // Nothing in the app, the admin pages or the API is listed.
    expect(urls.some((u) => /\/(app|admin|api)/.test(u))).toBe(false);
  });
});

describe("search description and name", () => {
  it("describes what the product does in plain words, with no numbers or promises", async () => {
    const { siteMetadata } = await import("@/lib/seo");
    const metadata = siteMetadata;
    const description = String(metadata.description);
    expect(description).toContain("public conversations");
    expect(description).toContain("in your own words");
    expect(description).not.toMatch(/\d/);
    expect(metadata.metadataBase?.toString()).toBe("https://feedyourbusiness.app/");
    expect(metadata.openGraph).toMatchObject({ siteName: "FeedYourBusiness" });
  });
});

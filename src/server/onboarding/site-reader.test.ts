import { describe, expect, it } from "vitest";
import { OwnSiteError, type OwnSitePage } from "@/server/net/own-site";
import { readSite, type SiteReaderDeps } from "./site-reader";

/**
 * The site reader (docs/PLAN.md 8.3 step 2): the pasted page plus up to 5 more pages on the same
 * site that say what the product does. Every page is invented.
 */

const ORIGIN = "https://acme.example";

const page = (title: string, links: string[] = [], body = `${title} body text.`) =>
  `<html><head><title>${title}</title></head><body>` +
  links.map((l) => `<a href="${l}">link</a> `).join("") +
  `<p>${body}</p></body></html>`;

const HOME_LINKS = [
  "/about/team",
  "/blog/new-features",
  "/customers/pricing-story",
  "/blog/launch",
  "/customers",
  "/team",
  "/careers",
  "/about",
  "/pricing",
  "/features",
  "/acme-vs-rival",
  "/docs/start",
  "/faq",
  "/integrations",
  "/login",
  "https://x.com/acme",
  "https://www.linkedin.com/company/acme",
  "https://www.producthunt.com/products/acme",
  "https://partner.example/",
];

const SITE: Record<string, string> = {
  [`${ORIGIN}/`]: page("Acme home", HOME_LINKS),
  [`${ORIGIN}/pricing`]: page("Pricing"),
  [`${ORIGIN}/features`]: page("Features"),
  [`${ORIGIN}/acme-vs-rival`]: page("Acme vs Rival"),
  [`${ORIGIN}/about`]: page("About"),
  [`${ORIGIN}/faq`]: page("FAQ"),
  [`${ORIGIN}/docs/start`]: page("Docs"),
  [`${ORIGIN}/integrations`]: page("Integrations"),
  [`${ORIGIN}/customers`]: page("Customers"),
  [`${ORIGIN}/team`]: page("Team"),
  [`${ORIGIN}/blog/launch`]: page("Blog"),
  [`${ORIGIN}/about/team`]: page("Our team"),
  [`${ORIGIN}/blog/new-features`]: page("New features post"),
  [`${ORIGIN}/customers/pricing-story`]: page("A customer story"),
};

function fakeSite(
  pages: Record<string, string>,
  {
    robots,
    robotsError = new OwnSiteError("http_status", "acme.example", "404", 404),
    failing = [] as string[],
  }: { robots?: string; robotsError?: OwnSiteError; failing?: string[] } = {},
) {
  const requested: string[] = [];
  let clock = 0;
  const deps: SiteReaderDeps = {
    now: () => clock,
    fetchPage: async (url: string): Promise<OwnSitePage> => {
      requested.push(url);
      clock += 1_000;
      if (url.endsWith("/robots.txt")) {
        if (robots === undefined) throw robotsError;
        return { url, contentType: "text/plain", body: robots };
      }
      const body = pages[url];
      if (!body || failing.includes(url)) {
        throw new OwnSiteError("http_status", "acme.example", "404", 404);
      }
      return { url, contentType: "text/html", body };
    },
  };
  return { deps, requested, advance: (ms: number) => (clock += ms) };
}

describe("readSite", () => {
  it("reads the pasted page and the 5 best same-site pages in keyword order", async () => {
    const { deps, requested } = fakeSite(SITE);
    const result = await readSite(`${ORIGIN}/`, deps);
    expect(result?.pages).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/pricing`,
      `${ORIGIN}/features`,
      `${ORIGIN}/acme-vs-rival`,
      `${ORIGIN}/faq`,
      `${ORIGIN}/docs/start`,
    ]);
    expect(requested).toEqual([`${ORIGIN}/`, `${ORIGIN}/robots.txt`, ...result!.pages.slice(1)]);
  });

  it("never follows another host or a page about people", async () => {
    const { deps, requested } = fakeSite(SITE);
    await readSite(`${ORIGIN}/`, deps);
    for (const url of requested) expect(new URL(url).hostname).toBe("acme.example");
    for (const path of [
      "/customers",
      "/team",
      "/careers",
      "/blog/launch",
      "/login",
      "/about/team",
      "/blog/new-features",
      "/customers/pricing-story",
    ]) {
      expect(requested).not.toContain(`${ORIGIN}${path}`);
    }
  });

  it("joins the text with a header per page, the pasted page first", async () => {
    const { deps } = fakeSite(SITE);
    const result = await readSite(`${ORIGIN}/`, deps);
    expect(result?.text.startsWith("Page: /\nAcme home\n")).toBe(true);
    expect(result?.text).toContain("\n\nPage: /pricing\nPricing\nPricing body text.");
    expect(result?.text).not.toContain("x.com");
  });

  it("caps the text at 30,000 characters in all", async () => {
    const big = "word ".repeat(10_000);
    const pages = Object.fromEntries(
      Object.entries(SITE).map(([url, html]) => [url, html.replace("body text.", big)]),
    );
    const { deps } = fakeSite(pages);
    const result = await readSite(`${ORIGIN}/`, deps);
    expect(result!.text.length).toBeLessThanOrEqual(30_000);
    expect(result!.text.startsWith("Page: /\n")).toBe(true);
  });

  it("honors robots.txt for the extra pages", async () => {
    const { deps, requested } = fakeSite(SITE, {
      robots: "User-agent: *\nDisallow: /pricing\nDisallow: /features",
    });
    const result = await readSite(`${ORIGIN}/`, deps);
    expect(requested).not.toContain(`${ORIGIN}/pricing`);
    expect(requested).not.toContain(`${ORIGIN}/features`);
    expect(result?.pages).toContain(`${ORIGIN}/integrations`);
  });

  it("reads every page when robots.txt answers 4xx", async () => {
    const { deps } = fakeSite(SITE);
    expect((await readSite(`${ORIGIN}/`, deps))?.pages).toHaveLength(6);
  });

  it.each([
    ["a 5xx", new OwnSiteError("http_status", "acme.example", "503", 503)],
    ["a timeout", new OwnSiteError("timeout", "acme.example", "slow")],
    ["a redirect to another site", new OwnSiteError("redirect_off_site", "acme.example", "off")],
    ["a network failure", new OwnSiteError("network", "acme.example", "down")],
  ])("reads only the pasted page when robots.txt fails with %s", async (_label, robotsError) => {
    const { deps, requested } = fakeSite(SITE, { robotsError });
    const result = await readSite(`${ORIGIN}/`, deps);
    expect(result?.pages).toEqual([`${ORIGIN}/`]);
    expect(requested).toEqual([`${ORIGIN}/`, `${ORIGIN}/robots.txt`]);
  });

  it("matches whole path words: /devs is not a comparison page", async () => {
    const { deps, requested } = fakeSite({
      [`${ORIGIN}/`]: page("Home", ["/devs", "/aboutus-legacy"]),
      [`${ORIGIN}/devs`]: page("Devs"),
    });
    await readSite(`${ORIGIN}/`, deps);
    expect(requested).not.toContain(`${ORIGIN}/devs`);
  });

  it("goes on when one page fails, and the failure counts as one of the 5 attempts", async () => {
    const { deps } = fakeSite(SITE, { failing: [`${ORIGIN}/pricing`] });
    const result = await readSite(`${ORIGIN}/`, deps);
    expect(result?.pages).not.toContain(`${ORIGIN}/pricing`);
    expect(result?.pages).toContain(`${ORIGIN}/docs/start`);
    expect(result?.pages).toHaveLength(5);
  });

  it("makes at most 7 requests even when every extra page fails", async () => {
    const failing = Object.keys(SITE).filter((url) => url !== `${ORIGIN}/`);
    const { deps, requested } = fakeSite(SITE, { failing });
    const result = await readSite(`${ORIGIN}/`, deps);
    expect(requested.length).toBeLessThanOrEqual(7);
    expect(result?.pages).toEqual([`${ORIGIN}/`]);
  });

  it("throws away a page that redirects to a people page or a disallowed path", async () => {
    const { deps } = fakeSite(SITE, { robots: "User-agent: *\nDisallow: /secret" });
    const redirecting: SiteReaderDeps = {
      ...deps,
      fetchPage: async (url) => {
        if (url === `${ORIGIN}/pricing`)
          return { ...(await deps.fetchPage(`${ORIGIN}/about/team`)) };
        if (url === `${ORIGIN}/features`) {
          return {
            url: `${ORIGIN}/secret/features`,
            contentType: "text/html",
            body: page("Secret"),
          };
        }
        return deps.fetchPage(url);
      },
    };
    const result = await readSite(`${ORIGIN}/`, redirecting);
    expect(result?.pages).not.toContain(`${ORIGIN}/about/team`);
    expect(result?.pages).not.toContain(`${ORIGIN}/secret/features`);
    expect(result?.text).not.toContain("Our team");
    expect(result?.text).not.toContain("Secret");
  });

  it("reads the home page instead of a pasted people page", async () => {
    const { deps, requested } = fakeSite(SITE);
    const result = await readSite(`${ORIGIN}/blog/launch`, deps);
    expect(requested[0]).toBe(`${ORIGIN}/`);
    expect(requested).not.toContain(`${ORIGIN}/blog/launch`);
    expect(result?.pages[0]).toBe(`${ORIGIN}/`);
  });

  it("reads the home page when the pasted page redirects to a people page", async () => {
    const { deps, requested } = fakeSite(SITE);
    const redirecting: SiteReaderDeps = {
      ...deps,
      fetchPage: async (url) =>
        url === `${ORIGIN}/company` ? deps.fetchPage(`${ORIGIN}/about/team`) : deps.fetchPage(url),
    };
    const result = await readSite(`${ORIGIN}/company`, redirecting);
    expect(result?.pages[0]).toBe(`${ORIGIN}/`);
    expect(requested.slice(0, 2)).toEqual([`${ORIGIN}/about/team`, `${ORIGIN}/`]);
    // The swap counts as an attempt: page, home, robots.txt and 4 more.
    expect(requested.length).toBeLessThanOrEqual(7);
  });

  it("reads extra pages only on the pasted page's own host, not its www twin", async () => {
    const { deps, requested } = fakeSite({
      [`${ORIGIN}/`]: page("Home", ["https://www.acme.example/pricing", "/features"]),
      [`${ORIGIN}/features`]: page("Features"),
    });
    await readSite(`${ORIGIN}/`, deps);
    expect(requested).not.toContain("https://www.acme.example/pricing");
    expect(requested).toContain(`${ORIGIN}/features`);
  });

  it("stops fetching when the 30 second budget is spent", async () => {
    const { deps, requested, advance } = fakeSite(SITE);
    const slow: SiteReaderDeps = {
      ...deps,
      fetchPage: async (url) => {
        try {
          return await deps.fetchPage(url);
        } finally {
          advance(9_000);
        }
      },
    };
    const result = await readSite(`${ORIGIN}/`, slow);
    // 10 seconds per request: the page, robots.txt and one more fit before 30 seconds pass.
    expect(requested).toHaveLength(3);
    expect(result?.pages).toEqual([`${ORIGIN}/`, `${ORIGIN}/pricing`]);
  });

  it("returns null when the pasted page cannot be read", async () => {
    const { deps } = fakeSite({});
    expect(await readSite(`${ORIGIN}/`, deps)).toBeNull();
  });

  it("returns null when no page has any text", async () => {
    const { deps } = fakeSite({
      [`${ORIGIN}/`]: "<html><body><script>app()</script></body></html>",
    });
    expect(await readSite(`${ORIGIN}/`, deps)).toBeNull();
  });

  it("reads a plain text page as it is", async () => {
    const { deps } = fakeSite({});
    const plain: SiteReaderDeps = {
      ...deps,
      fetchPage: async (url) =>
        url.endsWith("robots.txt")
          ? Promise.reject(new OwnSiteError("http_status", "acme.example", "404"))
          : { url, contentType: "text/plain", body: "Acme sends invoices." },
    };
    expect((await readSite(`${ORIGIN}/llms.txt`, plain))?.text).toBe(
      "Page: /llms.txt\nAcme sends invoices.",
    );
  });

  it("uses the page's final URL for links after a redirect to the www twin", async () => {
    const www = "https://www.acme.example";
    const { deps, requested } = fakeSite({
      [`${www}/`]: page("Home", ["/pricing"]),
      [`${www}/pricing`]: page("Pricing"),
    });
    const redirected: SiteReaderDeps = {
      ...deps,
      fetchPage: async (url) =>
        url === `${ORIGIN}/` ? { ...(await deps.fetchPage(`${www}/`)) } : deps.fetchPage(url),
    };
    const result = await readSite(`${ORIGIN}/`, redirected);
    expect(result?.pages).toEqual([`${www}/`, `${www}/pricing`]);
    expect(requested).toContain(`${www}/robots.txt`);
  });
});

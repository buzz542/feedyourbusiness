import { describe, expect, it } from "vitest";
import {
  extractPageText,
  extractSameSiteLinks,
  isAllowedByRobots,
  parseRobots,
  robotsPatternMatches,
} from "./page-text";

/** Page text for the onboarding draft (docs/PLAN.md 8.3 step 2). Fixtures are invented. */

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <title>Acme Invoices &amp; Receipts</title>
  <meta name="description" content="Send invoices from your phone.">
  <meta property="og:title" content="ignored">
  <style>body { color: red }</style>
  <script>window.track("secret")</script>
  <script type="application/ld+json">{"@type":"Organization"}</script>
</head>
<body>
  <header>
    <a href="/">Acme</a>
    <nav><a href="/pricing">Pricing</a><a href="/blog">Blog</a></nav>
    <h1>Invoices for freelancers</h1>
  </header>
  <main>
    <p>Acme turns a photo of a receipt into an invoice&nbsp;in seconds.</p>
    <h2>Why Acme</h2>
    <ul><li>Works offline</li><li>Exports to &lt;CSV&gt; &#8211; and PDF &#x2014; fast</li></ul>
    <noscript>Enable JavaScript</noscript>
    <svg><text>logo text</text></svg>
    <template><p>hidden template</p></template>
    <!-- a comment with <p>markup</p> -->
    <div hidden>hidden div</div>
    <div role="navigation"><a href="/x">Menu</a></div>
  </main>
  <footer><p>Copyright Acme. Terms. Privacy.</p></footer>
</body>
</html>`;

describe("extractPageText", () => {
  const text = extractPageText(PAGE);

  it("keeps the title, the meta description, headings and body text in reading order", () => {
    expect(text).toBe(
      [
        "Acme Invoices & Receipts",
        "Send invoices from your phone.",
        "Acme",
        "Invoices for freelancers",
        "Acme turns a photo of a receipt into an invoice in seconds.",
        "Why Acme",
        "Works offline",
        "Exports to <CSV> - and PDF - fast",
      ].join("\n"),
    );
  });

  it.each([
    ["scripts", "secret"],
    ["JSON-LD", "Organization"],
    ["styles", "color: red"],
    ["navigation", "Pricing"],
    ["role=navigation", "Menu"],
    ["footers", "Copyright"],
    ["noscript", "Enable JavaScript"],
    ["svg", "logo text"],
    ["templates", "hidden template"],
    ["comments", "a comment"],
    ["hidden elements", "hidden div"],
  ])("drops %s", (_label, needle) => {
    expect(text).not.toContain(needle);
  });

  it("never writes an em or en dash, so the draft cannot copy one into the profile", () => {
    expect(text).not.toMatch(/[–—]/);
  });

  it("caps its output", () => {
    const huge = `<p>${"word ".repeat(20_000)}</p>`;
    expect(extractPageText(huge, 500).length).toBeLessThanOrEqual(500);
  });

  it("survives broken markup", () => {
    expect(extractPageText("<p>Unclosed <b>bold <script>x")).toBe("Unclosed bold");
    expect(extractPageText("")).toBe("");
  });
});

describe("extractSameSiteLinks", () => {
  const html = `
    <a href="/pricing">Pricing</a>
    <a href="https://www.acme.example/features?ref=nav#top">Features</a>
    <a href="docs/start">Docs</a>
    <a href="https://x.com/acme">Our X</a>
    <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
    <a href="https://www.producthunt.com/products/acme">Product Hunt</a>
    <a href="https://partner.example/">Partner</a>
    <a href="https://shop.acme.example/">Shop</a>
    <a href="mailto:hi@acme.example">Mail</a>
    <a href="javascript:void(0)">JS</a>
    <a href="http://acme.example/about">About over http</a>
    <a href = '/faq' >FAQ</a>
    <a href="/pricing">Pricing again</a>
  `;

  it("keeps same-site https links, without query or fragment, once each", () => {
    expect(extractSameSiteLinks(html, "https://acme.example/")).toEqual([
      "https://acme.example/pricing",
      "https://www.acme.example/features",
      "https://acme.example/docs/start",
      "https://acme.example/faq",
    ]);
  });
});

describe("isAllowedByRobots", () => {
  const robots = `
    # comment
    User-agent: OtherBot
    Disallow: /

    User-agent: *
    Disallow: /private
    Disallow: /*.pdf$
    Allow: /private/ok

    User-agent: AskedFor
    Disallow: /pricing
  `;

  it("uses the group for our User-Agent when there is one", () => {
    expect(isAllowedByRobots(robots, "/pricing")).toBe(false);
    expect(isAllowedByRobots(robots, "/private")).toBe(true);
  });

  it("falls back to the * group, longest match wins, with wildcards", () => {
    const star = "User-agent: *\nDisallow: /private\nDisallow: /*.pdf$\nAllow: /private/ok";
    expect(isAllowedByRobots(star, "/private/x")).toBe(false);
    expect(isAllowedByRobots(star, "/private/ok/y")).toBe(true);
    expect(isAllowedByRobots(star, "/guide.pdf")).toBe(false);
    expect(isAllowedByRobots(star, "/guide.pdf.html")).toBe(true);
    expect(isAllowedByRobots(star, "/features")).toBe(true);
  });

  it.each([
    ["an empty User-agent line", "User-agent:\nAllow: /\n\nUser-agent: *\nDisallow: /"],
    ["a token that is part of ours", "User-agent: ask\nAllow: /\n\nUser-agent: *\nDisallow: /"],
    [
      "a token that contains ours",
      "User-agent: AskedForMore\nAllow: /\n\nUser-agent: *\nDisallow: /",
    ],
  ])("does not take %s for our group", (_label, robotsTxt) => {
    expect(isAllowedByRobots(robotsTxt, "/pricing")).toBe(false);
  });

  it("matches our token in any case", () => {
    expect(isAllowedByRobots("User-agent: ASKEDFOR\nDisallow: /x", "/x")).toBe(false);
  });

  it("allows everything when the file is empty or has no group for us", () => {
    expect(isAllowedByRobots("", "/anything")).toBe(true);
    expect(isAllowedByRobots("User-agent: OtherBot\nDisallow: /", "/anything")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow:", "/anything")).toBe(true);
  });
});

describe("hostile input costs linear time", () => {
  const within = (ms: number, fn: () => unknown) => {
    const start = performance.now();
    fn();
    expect(performance.now() - start).toBeLessThan(ms);
  };

  it("2 MB of unclosed tags", () => {
    const html = "<a".repeat(1_000_000);
    within(1500, () => extractPageText(html));
    within(1500, () => extractSameSiteLinks(html, "https://acme.example/"));
  });

  it("2 MB of unclosed doctypes and comments", () => {
    within(1500, () => extractPageText("<!x".repeat(700_000)));
    within(1500, () => extractPageText("<!--".repeat(500_000)));
  });

  it("140,000 empty raw-text elements", () => {
    within(1500, () => extractPageText("<title></title><script></script>".repeat(70_000)));
  });

  it("a robots pattern with many wildcards against a long path", () => {
    const pattern = "/*a*a*a*a*a*a*a*a*a*a*a*a*b";
    within(50, () => robotsPatternMatches(pattern, `/pricing/${"a".repeat(300)}`));
  });

  it("a 2 MB robots.txt", () => {
    const robots = `User-agent: *\n${"Disallow: /docs/x*y*z\n".repeat(100_000)}`;
    within(1500, () => parseRobots(robots));
  });
});

describe("robots details (RFC 9309)", () => {
  it("accepts CR-only line endings", () => {
    expect(isAllowedByRobots("User-agent: *\rDisallow: /", "/pricing")).toBe(false);
  });

  it("matches a token written with a version", () => {
    expect(isAllowedByRobots("User-agent: AskedFor/1.0\nDisallow: /x", "/x")).toBe(false);
  });

  it("matches wildcards the way the RFC does", () => {
    expect(robotsPatternMatches("/a*b*c", "/aXbYc")).toBe(true);
    expect(robotsPatternMatches("/a*b*c", "/aXcYb")).toBe(false);
    expect(robotsPatternMatches("/a*c$", "/abc")).toBe(true);
    expect(robotsPatternMatches("/a*c$", "/abcd")).toBe(false);
    expect(robotsPatternMatches("/a$", "/a")).toBe(true);
    expect(robotsPatternMatches("/a$", "/ab")).toBe(false);
    expect(robotsPatternMatches("*", "/anything")).toBe(true);
  });
});

describe("meta descriptions", () => {
  it("reads og:description from property as well as name", () => {
    const html = `<head><meta property="og:description" content="From Open Graph."></head><p>Body</p>`;
    expect(extractPageText(html)).toBe("From Open Graph.\nBody");
  });
});

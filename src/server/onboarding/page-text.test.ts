import { describe, expect, it } from "vitest";
import { extractPageText, MAX_PAGE_TEXT } from "./page-text";

/** The visible text of the user's own page, for the onboarding draft (docs/PLAN.md 8.3). */

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice Pal &amp; friends</title>
  <meta name="description" content="Send invoices that get paid on time.">
  <meta property="og:title" content="ignored">
  <style>body { color: red } .hero::after { content: "STYLE TEXT" }</style>
  <script>window.track("SCRIPT TEXT");</script>
  <script type="application/ld+json">{"name": "JSON TEXT"}</script>
</head>
<body>
  <header><a href="/">Logo</a><nav><a href="/pricing">NAV PRICING</a><a href="/blog">NAV BLOG</a></nav></header>
  <!-- COMMENT TEXT -->
  <main>
    <h1>Invoicing for freelancers</h1>
    <p>Create an invoice in a minute.<br>Get reminders when a client is late.</p>
    <h2>Why it&#39;s different</h2>
    <ul><li>Automatic&nbsp;reminders</li><li>Payment links &mdash; cards and bank</li></ul>
    <noscript>NOSCRIPT TEXT</noscript>
    <svg><text>SVG TEXT</text></svg>
    <template><p>TEMPLATE TEXT</p></template>
    <iframe src="https://video.example/embed">IFRAME TEXT</iframe>
    <div role="navigation">ROLE NAV TEXT</div>
  </main>
  <footer>FOOTER TEXT &copy; 2026</footer>
</body>
</html>`;

describe("extractPageText", () => {
  const text = extractPageText(PAGE);

  it("keeps the title, the meta description, headings and body text", () => {
    expect(text).toContain("Title: Invoice Pal & friends");
    expect(text).toContain("Description: Send invoices that get paid on time.");
    expect(text).toContain("Invoicing for freelancers");
    expect(text).toContain("Create an invoice in a minute.");
    expect(text).toContain("Get reminders when a client is late.");
    expect(text).toContain("Why it's different");
    expect(text).toContain("Automatic reminders");
  });

  it.each([
    "SCRIPT TEXT",
    "JSON TEXT",
    "STYLE TEXT",
    "NAV PRICING",
    "NAV BLOG",
    "COMMENT TEXT",
    "NOSCRIPT TEXT",
    "SVG TEXT",
    "TEMPLATE TEXT",
    "IFRAME TEXT",
    "ROLE NAV TEXT",
    "FOOTER TEXT",
  ])("drops %s", (marker) => {
    expect(text).not.toContain(marker);
  });

  it("leaves no markup behind and keeps lines apart", () => {
    expect(text).not.toMatch(/<|>/);
    expect(text).toMatch(/Create an invoice in a minute\.\nGet reminders/);
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).not.toMatch(/ {2,}/);
  });

  it("decodes entities, so the draft reads real words", () => {
    expect(text).toContain("Payment links \u2014 cards and bank");
    expect(text).not.toMatch(/&[a-z]+;|&#\d+;/);
  });

  it("caps the output at 30,000 characters", () => {
    const huge = `<html><body><p>${"word ".repeat(20_000)}</p></body></html>`;
    expect(MAX_PAGE_TEXT).toBe(30_000);
    expect(extractPageText(huge).length).toBe(30_000);
  });

  it("handles a page with no title, description or body", () => {
    expect(extractPageText("")).toBe("");
    expect(extractPageText("<html><head></head><body></body></html>")).toBe("");
  });

  it("handles plain text as it is", () => {
    expect(extractPageText("Just a plain description.\nSecond line.", "text/plain")).toBe(
      "Just a plain description.\nSecond line.",
    );
  });

  it("is not fooled by unclosed or oddly cased tags", () => {
    const odd = `<SCRIPT>bad()</SCRIPT><p>Good</p><Style>x{}</STYLE><script src="a.js"></script><p>Also good`;
    const out = extractPageText(odd);
    expect(out).toContain("Good");
    expect(out).toContain("Also good");
    expect(out).not.toContain("bad()");
    expect(out).not.toContain("x{}");
  });

  it("drops an unclosed script to the end rather than leaking it", () => {
    expect(extractPageText("<p>Visible</p><script>leak()")).toBe("Visible");
  });

  it("keeps a hero heading inside the page header, and drops the navigation beside it", () => {
    const out = extractPageText(
      `<body><header><nav><a href="/">NAV HOME</a></nav><h1>Invoicing for freelancers</h1>` +
        `<p>Get paid on time</p></header><main><p>More</p></main></body>`,
    );
    expect(out).toBe("Invoicing for freelancers\nGet paid on time\nMore");
  });

  it("keeps an apostrophe inside a double-quoted description, in either attribute order", () => {
    expect(extractPageText(`<meta name="description" content="It's fast, isn't it">`)).toBe(
      "Description: It's fast, isn't it",
    );
    expect(extractPageText(`<meta content='Say "hi"' name='description'>`)).toBe(
      'Description: Say "hi"',
    );
  });

  it("does not end a tag at a > inside a quoted attribute", () => {
    const out = extractPageText(`<body><a title="a > b" href="/">Link</a><p>Next</p></body>`);
    expect(out).toBe("Link\nNext");
  });

  it("drops nested navigation whole, and keeps what follows it", () => {
    const out = extractPageText(
      `<body><nav><ul><li><nav>INNER</nav></li><li>OUTER NAV</li></ul></nav><p>After</p>` +
        `<div role="navigation"><div>ROLE INNER</div>ROLE OUTER</div><p>Kept</p></body>`,
    );
    expect(out).toBe("After\nKept");
  });

  it("reads the body when the head is never closed", () => {
    const out = extractPageText(
      `<html><head><title>T</title><meta name="description" content="D"><body><p>Body text</p>`,
    );
    expect(out).toBe("Title: T\n\nDescription: D\n\nBody text");
  });

  it("takes the page title, never an icon's title inside svg", () => {
    expect(
      extractPageText(
        `<head><title>Real</title></head><body><svg><title>Icon</title></svg></body>`,
      ),
    ).toBe("Title: Real");
    expect(extractPageText(`<body><svg><title>Icon</title></svg><p>Hi</p></body>`)).toBe("Hi");
  });

  it("never ends the capped output with half a character", () => {
    const out = extractPageText(`<body><p>${"\u{1F600}".repeat(20_000)}</p></body>`);
    expect(out.length).toBeLessThanOrEqual(MAX_PAGE_TEXT);
    const last = out.charCodeAt(out.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });
});

describe("extractPageText on a crafted page", () => {
  // A user's own page (up to fetchOwnSite's 2 MB) reaches this unchanged, so it must run in linear
  // time: the first version took 27 seconds on 200 KB of "<a " and would have held a function for
  // its whole limit at 2 MB. Synchronous code cannot be interrupted by a test timeout, so the pages
  // are 512 KB: a quadratic regression fails here within minutes instead of hanging CI.
  const SIZE = 512 * 1024;
  it.each([
    ["unclosed scripts", "<body>" + "<script>".repeat(SIZE / 8)],
    ["tags that never close", "<body>" + "<script ".repeat(SIZE / 8)],
    ["a bare < run", "<body>" + "<a ".repeat(SIZE / 3)],
    ["unclosed role=navigation", "<body>" + "<div role=navigation>".repeat(SIZE / 21)],
    ["unclosed comments", "<body>" + "<!--".repeat(SIZE / 4)],
    ["unclosed titles", "<title " + "<title>".repeat(SIZE / 7)],
    ["unterminated quotes", "<body>" + `<a title="x`.repeat(SIZE / 11)],
    ["unclosed nav", "<body>" + "<nav>".repeat(SIZE / 5)],
    ["unclosed heads", "<head>".repeat(SIZE / 6)],
    ["entities", "<body>" + "&#x1F600;&amp".repeat(SIZE / 13)],
    ["ordinary paragraphs", "<body>" + "<p>hello world</p>".repeat(SIZE / 18)],
  ])("%s finish within 1.5 seconds", (_label, html) => {
    const started = performance.now();
    extractPageText(html);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

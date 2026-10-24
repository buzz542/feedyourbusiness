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
    expect(extractPageText(huge).length).toBeLessThanOrEqual(30_000);
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
});

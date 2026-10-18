import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_PAGE_TEXT, pageText } from "./page-text";

const html = readFileSync("tests/fixtures/pages/invoicer.html", "utf8");

describe("pageText (docs/PLAN.md 8.3)", () => {
  const text = pageText(html, "text/html");

  it("keeps the title, meta description and headings, labeled", () => {
    expect(text).toContain("Title: Invoicer & Co | Invoices that chase themselves");
    expect(text).toContain("Description: Invoicer sends polite reminders until your clients pay.");
    expect(text).toContain("- Get paid on time, every time");
    expect(text).toContain("- Who it is for");
    expect(text).toContain("- Pricing that scales");
  });

  it("keeps the body text with entities decoded", () => {
    expect(text).toContain("It sends friendly reminders \u2014 so you don't have to.");
    expect(text).toContain(
      "Freelance designers and developers who send fewer than 50 invoices a month.",
    );
    expect(text).toContain("Late fees on request");
  });

  it("drops scripts, styles, JSON-LD, comments, noscript, templates and SVG", () => {
    for (const gone of [
      "__TRACK__",
      "Not a heading",
      "Hidden JSON",
      "color: red",
      "Commented out",
      "Enable JavaScript",
      "Template text",
      "Icon title",
    ])
      expect(text, gone).not.toContain(gone);
  });

  it("drops navigation and the footer", () => {
    for (const gone of ["Log in", "Docs", "Privacy"]) expect(text, gone).not.toContain(gone);
  });

  it("does not trip on > inside attributes or < inside scripts", () => {
    expect(text).not.toContain('b">');
    expect(text).not.toMatch(/<\/?[a-z]/i);
  });

  it("caps the output at 30,000 characters", () => {
    const long = `<html><body><p>${"word ".repeat(20_000)}</p></body></html>`;
    const out = pageText(long, "text/html");
    expect(MAX_PAGE_TEXT).toBe(30_000);
    expect(out.length).toBeLessThanOrEqual(30_000);
    expect(out.length).toBeGreaterThan(29_000);
  });

  it("passes plain text through, collapsed and capped", () => {
    expect(pageText("Hello\r\n\r\n\r\n  world  ", "text/plain")).toBe("Hello\n\nworld");
    expect(pageText("a".repeat(40_000), "text/plain")).toHaveLength(30_000);
  });

  it("handles a page with no title, headings or body text", () => {
    expect(
      pageText("<html><head></head><body><script>x()</script></body></html>", "text/html"),
    ).toBe("");
  });

  it("survives unclosed tags and stray brackets", () => {
    const out = pageText("<p>1 < 2 and 3 > 2<div>open <b>bold", "text/html");
    expect(out).toContain("1 < 2 and 3 > 2");
    expect(out).toContain("open bold");
  });
});

describe("pageText on a second fixture page", () => {
  const text = pageText(readFileSync("tests/fixtures/pages/scheduly.html", "utf8"), "text/html");

  it("keeps the visible text", () => {
    expect(text).toContain("Title: Scheduly - booking for small studios");
    expect(text).toContain("Description: Scheduly books client calls without the back and forth.");
    expect(text).toContain("- Book calls without the email ping-pong");
    expect(text).toContain("- How it works");
    expect(text).toContain("Share one link.");
    expect(text).toContain("Connect your calendar");
    expect(text).toContain("\nPlan Solo Studio\n");
    expect(text).toContain("- FAQ");
    expect(text).toContain("Does it work with my calendar?");
  });

  it("drops dialogs, navigation and scripts", () => {
    for (const gone of ["We use one cookie", "Developer docs", "Jump to", "app.js"])
      expect(text, gone).not.toContain(gone);
  });
});

describe("pageText edge cases", () => {
  const html = (body: string) => pageText(body, "text/html");
  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

  it("finds a raw-text end tag in the original string (case folding cannot shift it)", () => {
    const out = html(
      "\u0130".repeat(20) + "<style>p{}</style><p>Hello</p><script>var s='<b>x</b>'</script>",
    );
    expect(out).toContain("Hello");
    expect(out).not.toContain("var s");
  });

  it("does not end a script at a longer tag name", () => {
    expect(html("<script>a</scripts>b</script><p>After</p>")).toBe("Page:\nAfter");
  });

  it("never emits lone surrogates or C1 controls from numeric references", () => {
    expect(html("<p>a&#xD83D;b&#55357;c&#0;d&#x110000;e</p>")).toBe(
      "Page:\na\ufffdb\ufffdc\ufffdd\ufffde",
    );
    expect(html("<p>it&#146;s &#150; &#x1F600;</p>")).toBe("Page:\nit\u2019s \u2013 \u{1F600}");
    expect(html("<p>&#xD83D;&#xDE00;</p>")).not.toMatch(LONE_SURROGATE);
  });

  it("does not cut an emoji in half at the cap", () => {
    // "Page:\n" is 6 characters, so the emoji's first half is the 30,000th character.
    const out = html(`<p>${"a".repeat(MAX_PAGE_TEXT - 7)}\u{1F600}${"b".repeat(50)}</p>`);
    expect(out).toHaveLength(MAX_PAGE_TEXT - 1);
    expect(out).not.toMatch(LONE_SURROGATE);
  });

  it("skips nested elements inside a skipped one, up to its own end tag", () => {
    expect(html('<div role="navigation"><div>a</div>Docs</div><p>After</p>')).toBe("Page:\nAfter");
    expect(html("<nav><nav>x</nav>Docs</nav><p>After</p>")).toBe("Page:\nAfter");
  });

  it("treats script content inside a skipped element as script, not markup", () => {
    const out = html("<nav><script>m.innerHTML='</nav>'</script><a>Log in</a></nav><p>Main</p>");
    expect(out).toBe("Page:\nMain");
    expect(html("<nav><script>x='<nav '</script>Menu</nav><p>Main</p>")).toBe("Page:\nMain");
  });

  it("ends a skipped paragraph where the browser would", () => {
    expect(html('<p role="navigation">Links<div>Main</div>')).toBe("Page:\nMain");
  });

  it("ends an unclosed skipped element at the end of the body", () => {
    expect(html('<div role="navigation"><div>Links</div></body><p>Main</p>')).toContain("Main");
  });

  it("ignores a self-closing slash on ordinary elements", () => {
    expect(html("<nav data-base=/docs/>Log in</nav><p>Main</p>")).toBe("Page:\nMain");
    expect(html('<nav class="a"/>Log in</nav><p>Main</p>')).toBe("Page:\nMain");
    expect(html("<svg/><p>Main</p>")).toBe("Page:\nMain");
  });

  it("keeps words apart across line breaks inside headings", () => {
    expect(html("<h1>Invoices that<br>chase themselves</h1>")).toContain(
      "- Invoices that chase themselves",
    );
  });

  it("caps each heading, so an unclosed one cannot take the whole budget", () => {
    const out = html(`<h1>${"word ".repeat(10_000)}`);
    const headingLine = out.split("\n").find((line) => line.startsWith("- "));
    expect(headingLine!.length).toBeLessThanOrEqual(202);
    expect(out).toContain("Page:");
  });

  it("reads <!--> and <!---> as complete comments", () => {
    expect(html("<p>A</p><!--><p>B</p><!---><p>C</p>")).toBe("Page:\nA\n\nB\n\nC");
  });

  it("keeps the real content React streams into hidden divs", () => {
    const streamed =
      '<body><!--$?--><template id="B:0"></template><p>Loading...</p><!--/$-->' +
      '<div hidden id="S:0"><h1>Invoices that chase themselves</h1><p>Invoicer sends reminders.</p></div>' +
      '<script>$RC("B:0","S:0")</script></body>';
    const out = html(streamed);
    expect(out).toContain("- Invoices that chase themselves");
    expect(out).toContain("Invoicer sends reminders.");
    expect(out).not.toContain("$RC");
  });

  it("keeps aria-hidden text, which is still on screen", () => {
    expect(
      html(
        '<main><p><span class="icon" aria-hidden="true" /> Fast setup</p><h2>Plans</h2><p>Sends reminders</p></main>',
      ),
    ).toContain("Fast setup");
  });

  it("matches the navigation role in any case and among other roles", () => {
    expect(html('<div role="navigation menubar">Log in</div><p>Main</p>')).toBe("Page:\nMain");
    expect(html('<div role="Navigation">Log in</div><p>Main</p>')).toBe("Page:\nMain");
  });

  it("ends a skipped element where its parent closes, as a browser does", () => {
    const span = html(
      '<main><p><span role="navigation" /> Menu</p><h2>Plans</h2><p>Sends reminders</p></main>',
    );
    expect(span).toContain("- Plans");
    expect(span).toContain("Sends reminders");
    expect(html('<div><p role="navigation">Note</div><span>Pay in two clicks</span>')).toBe(
      "Page:\nPay in two clicks",
    );
    expect(html('<ul><li><p role="navigation">Soon</li><li>Invoices</li></ul><span>x</span>')).toBe(
      "Page:\nInvoices\n\nx",
    );
  });

  it("ends a skipped list item at the next item, as optional end tags do", () => {
    expect(html('<ul><li role="navigation">Soon<li>Invoices<li>Reminders</ul><p>More</p>')).toBe(
      "Page:\nInvoices\nReminders\n\nMore",
    );
    expect(html('<li role="navigation"><ul><li>Docs</li></ul></li><p>After</p>')).toBe(
      "Page:\nAfter",
    );
  });

  it("closes the innermost element first while skipping", () => {
    expect(html("<div><nav><div>x</div>Docs</nav></div><p>After</p>")).toBe("Page:\nAfter");
  });

  it("drops nested templates, media fallback and svg with a spaced slash", () => {
    expect(html("<template><template>a</template>Tpl text</template><p>After</p>")).toBe(
      "Page:\nAfter",
    );
    expect(html("<video>Your browser does not support the video tag</video><p>After</p>")).toBe(
      "Page:\nAfter",
    );
    expect(html("<svg / ><title>Icon</title></svg><p>After</p>")).toBe("Page:\nAfter");
  });

  it("does not read a self-closed style or script inside svg as raw text", () => {
    expect(html("<svg><style/><script/></svg><p>After</p>")).toBe("Page:\nAfter");
  });

  it('ends a comment at "--!>"', () => {
    expect(html("<!-- a --!><p>After</p>")).toBe("Page:\nAfter");
  });

  it("caps the title, the description and the number of headings", () => {
    const out = html(
      `<title>${"t".repeat(1_000)}</title><meta name="description" content="${"d".repeat(1_000)}">` +
        Array.from({ length: 60 }, (_, i) => `<h2>Heading ${i}</h2>`).join(""),
    );
    expect(out).toContain(`Title: ${"t".repeat(300)}\n`);
    expect(out).toContain(`Description: ${"d".repeat(500)}\n`);
    expect(out.match(/^- Heading/gm)).toHaveLength(40);
  });

  it("maps unassigned C1 references to U+FFFD", () => {
    expect(html("<p>&#129;&#141;&#143;&#144;&#157;</p>")).toBe("Page:\n" + "\ufffd".repeat(5));
  });

  it.each([
    ["many empty raw-text elements", "<style></style>".repeat(130_000)],
    ["a tag that never closes", "<a ".repeat(600_000)],
    ["a quoted attribute that never closes", "<a b='".repeat(300_000)],
    ["deep nesting", "<div>".repeat(400_000)],
    ["deeply nested skipped elements", "<nav>".repeat(400_000)],
    ["many unquoted attributes", `<p ${"a=b ".repeat(500_000)}>x</p>`],
    ["many comments", "<!---->".repeat(299_000)],
    ["many comments between words", "a<!-- -->".repeat(230_000)],
  ])("stays linear on 2 MB of %s", (_label, input) => {
    expect(input.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    const started = performance.now();
    pageText(input, "text/html");
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

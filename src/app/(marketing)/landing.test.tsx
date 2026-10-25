import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExampleTabs } from "./_components/examples";
import Home from "./page";

/** The landing page (docs/PLAN.md 9.6). */

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const page = text(renderToStaticMarkup(<Home />));
const claims = readFileSync("docs/claims.md", "utf8").replace(/\s+/g, " ");

describe("the landing page", () => {
  it("labels every example card Example, with no handles or real names", () => {
    const examples = text(renderToStaticMarkup(<ExampleTabs />));
    expect(examples.match(/\bExample\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(examples).not.toMatch(/@\w|\bu\/\w|did:plc/);
  });

  it.each([
    "Who to reply to today. What your rivals get wrong. What to build next.",
    "AskedFor reads public conversations about the problem you solve, then shows you the people worth replying to, where your rivals fall short, and what people keep asking for.",
    "$29 a month, tax included where it applies. Card required for the trial. Renews monthly until you cancel.",
    "Raw posts are deleted from AskedFor after 30 days, or 7 days for Reddit and X.",
    "Reddit through a web data company that collects public Reddit pages for us (named on our sources page).",
    "You keep access until the end of the period you have paid for.",
    "We act within 30 days, and we aim for 72 hours.",
    "We email you at least 48 hours before your first charge.",
  ])("shows %j, which has a row in docs/claims.md", (claim) => {
    expect(page).toContain(claim);
    expect(claims).toContain(claim);
  });

  it("says where posts come from and links the sources page, the privacy notice and removal", () => {
    const html = renderToStaticMarkup(<Home />);
    for (const href of ["/sources", "/privacy", "/remove-my-post", "/login", "/pricing"])
      expect(html, href).toContain(`href="${href}"`);
    expect(page).toContain("This is not a data license from Reddit.");
    expect(page).toContain("Bright Data");
  });

  it("has no testimonials, user counts or badges", () => {
    expect(page).not.toMatch(
      /testimonial|customers love|users|trusted by|as seen on|product hunt/i,
    );
  });

  it("offers the instant preview inline", () => {
    expect(page).toContain("Try it on your product");
  });
});

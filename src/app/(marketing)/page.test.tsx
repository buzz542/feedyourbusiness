import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unclaimedBlocks } from "../../../compliance/lib/claims-blocks";
import { loadDenylist } from "../../../compliance/lib/denylist.mjs";
import { checkCopy, claimNumbers } from "../../../compliance/lib/scan-copy";
import Home, { metadata } from "./page";

/** The landing page (docs/PLAN.md 9.6, M9). */

const html = renderToStaticMarkup(<Home />);
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'")
  .replace(/\s+/g, " ");
const claims = readFileSync("docs/claims.md", "utf8");

describe("landing page", () => {
  it("has a claims row for every sentence, and for its description", () => {
    const { blocks, missing } = unclaimedBlocks(html);
    expect(blocks.length).toBeGreaterThanOrEqual(15);
    expect(missing).toEqual([]);
    expect(claims).toContain(metadata.description as string);
  });

  it("passes the copy gate as rendered", () => {
    expect(checkCopy([{ text, line: 1 }], "landing", loadDenylist(), claimNumbers(claims))).toEqual(
      [],
    );
  });

  it("labels the example as invented and shows no handle", () => {
    expect(text).toContain("Example, invented");
    expect(text).not.toMatch(/(^|\s)@\w|\bu\/\w/);
  });

  it("shows the example from a source collected at launch, never from one behind its gate", () => {
    const example = /aria-label="Example post card"[\s\S]*?<\/figure>/.exec(html)?.[0] ?? "";
    expect(example).toContain("Hacker News");
    expect(example).not.toMatch(/Reddit|r\/\w|\bX\b/);
  });

  it("puts every word of the example card in its claims row", () => {
    const row = claims.split("\n").find((l) => l.startsWith("| landing-example "))!;
    const example = /aria-label="Example post card"[\s\S]*?<\/figure>/.exec(html)![0];
    const pieces = [...example.matchAll(/>([^<>]+)</g)]
      // A highlight splits a sentence; the punctuation left at a piece's edge is not a word.
      .map((m) =>
        m[1]!
          .replace(/&#x27;/g, "'")
          .replace(/^[\s?.,·]+/, "")
          .trim(),
      )
      .filter(Boolean);
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) expect(row, piece).toContain(piece);
  });

  it("ends with the price and a way to start, and folds the questions into a list you can open", () => {
    const closing = html.slice(html.lastIndexOf('aria-labelledby="start"'));
    expect(closing).toContain("£39 a month, tax included where it applies");
    expect(closing).toMatch(/href="\/login\?next=%2Fapp"/);
    expect(html.match(/<details/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("says where posts come from, with the provider on the sources page, and shows the full price", () => {
    expect(text).toContain("Reddit through a web data company");
    expect(html).toContain('href="/sources"');
    expect(text).toContain("£39 a month, tax included where it applies");
  });

  it("says X is coming later, and no other sentence mentions X (out of launch, 8 Nov 2026)", () => {
    expect(text).toContain("X is coming later.");
    const sentences = text.split(/(?<=[.?!])\s+/);
    expect(sentences.filter((s) => /\bX\b/.test(s))).toEqual(["X is coming later."]);
  });

  it("shows no testimonials, counts or badges", () => {
    expect(text).not.toMatch(/testimonial|customers love|trusted by|as seen on|users\b/i);
  });
});

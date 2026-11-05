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

  it("says where posts come from, with the provider on the sources page, and shows the full price", () => {
    expect(text).toContain("Reddit through a web data company");
    expect(html).toContain('href="/sources"');
    expect(text).toContain("$29 a month, tax included where it applies");
  });

  it("shows no testimonials, counts or badges", () => {
    expect(text).not.toMatch(/testimonial|customers love|trusted by|as seen on|users\b/i);
  });
});

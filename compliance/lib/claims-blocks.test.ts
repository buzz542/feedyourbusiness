import { describe, expect, it } from "vitest";
import { unclaimedBlocks } from "./claims-blocks";

/** The page-claims check is itself tested with planted sentences. */

describe("unclaimedBlocks", () => {
  it("finds a planted sentence with no row, even inside a paragraph whose other sentence has one", () => {
    const html =
      "<p>Prices in US dollars. We are the best tool ever made.</p><li>An invented promise.</li>";
    expect(unclaimedBlocks(html).missing).toEqual([
      "We are the best tool ever made.",
      "An invented promise.",
    ]);
  });

  it("reads only the tags it is asked to, and never a pre block as a paragraph", () => {
    const html = "<pre>Not a claim.</pre><li>Not checked here.</li><p>Prices in US dollars.</p>";
    expect(unclaimedBlocks(html, ["p"])).toEqual({
      blocks: ["Prices in US dollars."],
      missing: [],
    });
  });
});

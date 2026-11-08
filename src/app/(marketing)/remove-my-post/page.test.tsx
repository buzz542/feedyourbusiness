import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unclaimedBlocks } from "../../../../compliance/lib/claims-blocks";
import { loadDenylist } from "../../../../compliance/lib/denylist.mjs";
import { checkCopy, claimNumbers } from "../../../../compliance/lib/scan-copy";
import { FORM_SOURCES } from "@/server/privacy/removal";
import Page, { metadata } from "./page";

/** Remove my post (docs/PLAN.md 4.8, M9). */

const html = renderToStaticMarkup(<Page />);

describe("/remove-my-post", () => {
  it("offers every source we collect from, and asks for a link or username and an email", () => {
    for (const source of FORM_SOURCES) expect(html).toContain(`value="${source}"`);
    // X is out of launch (8 Nov 2026): no option for a request its lookup could not handle.
    expect(html).not.toContain('value="x"');
    expect(html).toContain("Link to the post, or your username");
    expect(html).toContain('type="email"');
    expect(html).toContain('name="confirm"');
  });

  it("has a claims row for every paragraph and passes the copy gate as rendered", () => {
    expect(unclaimedBlocks(html).missing).toEqual([]);
    expect(readFileSync("docs/claims.md", "utf8")).toContain(metadata.description as string);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const claims = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    expect(checkCopy([{ text, line: 1 }], "remove", loadDenylist(), claims)).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../../../compliance/lib/denylist.mjs";
import { checkCopy, claimNumbers } from "../../../../compliance/lib/scan-copy";
import { CONTACT_EMAIL } from "@/lib/contact";
import { MAX_EXTRA_PAGES } from "@/server/onboarding/site-reader";
import { OWN_SITE_USER_AGENT } from "@/server/net/own-site";
import { unclaimedBlocks } from "../../../../compliance/lib/claims-blocks";
import BotPage from "./page";

/** /bot (docs/PLAN.md 12.3, M9): what the site reader does, its robots token, a contact. */

const html = renderToStaticMarkup(<BotPage />);
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'")
  .replace(/\s+/g, " ");

describe("/bot", () => {
  it("names the robots token and shows how to block it", () => {
    expect(text).toContain("the token AskedFor");
    expect(html).toContain("User-agent: AskedFor\nDisallow: /");
  });

  it("shows the exact User-Agent, which links back to this page", () => {
    expect(html).toContain(OWN_SITE_USER_AGENT);
    expect(OWN_SITE_USER_AGENT).toContain("https://askedfor.app/bot");
  });

  it("shows no contact address until the founder monitors it (F10), then shows it", () => {
    expect(html).not.toContain(CONTACT_EMAIL);
    expect(html).toContain("A contact address for the site reader is added here before launch.");
    const live = renderToStaticMarkup(<BotPage contactLive />);
    expect(live).toContain(`href="mailto:${CONTACT_EMAIL}"`);
  });

  it("states the reader's real limits", () => {
    expect(text).toContain(`up to ${MAX_EXTRA_PAGES} more pages`);
    expect(text).toContain("At most 7 requests");
  });

  it("has a claims row for every paragraph and list item, with or without the address", () => {
    expect(unclaimedBlocks(renderToStaticMarkup(<BotPage contactLive />)).missing).toEqual([]);
    const { blocks, missing } = unclaimedBlocks(html);
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    expect(missing).toEqual([]);
  });

  it("passes the copy gate as rendered", () => {
    const claims = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    expect(checkCopy([{ text, line: 1 }], "bot", loadDenylist(), claims)).toEqual([]);
  });
});

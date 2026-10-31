import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../../../compliance/lib/denylist.mjs";
import { checkCopy, claimNumbers } from "../../../../compliance/lib/scan-copy";
import { reddit } from "@/sources/reddit";
import type { CollectSource } from "@/sources/types";
import PrivacyPage from "../privacy/page";
import SourcesPage from "../sources/page";
import { DataProviderNotice } from "./data-provider-notice";

/** docs/PLAN.md 2.1.7 and 2.3.12: both pages name the data provider before Reddit is switched on. */
describe.each([
  ["the privacy notice", PrivacyPage],
  ["the sources page", SourcesPage],
])("%s", (_, Page) => {
  const html = renderToStaticMarkup(<Page />);

  it("names Bright Data and says what it collects", () => {
    expect(html).toContain("Bright Data");
    expect(html).toContain("public Reddit pages");
    expect(html).toContain("logged-out visitor");
  });

  it("says this is not a data license from Reddit", () => {
    expect(html).toContain("This is not a data license from Reddit.");
  });

  it("says the snapshot retention is stated before Reddit is switched on, and it stays off", () => {
    expect(html).toContain("before Reddit collection is switched on for AskedFor");
    expect(html).toContain("Until then, it stays off.");
  });

  it("says Reddit posts are deleted from AskedFor after 7 days", () => {
    expect(html).toContain("Reddit posts are deleted from AskedFor 7 days after we collect them.");
  });
});

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("once the retention is stated (F8)", () => {
  const stated = {
    ...(reddit as CollectSource),
    vendor: { ...(reddit as CollectSource).vendor!, snapshotRetention: "30 days" },
  } satisfies CollectSource;
  const text = textOf(renderToStaticMarkup(<DataProviderNotice source={stated} />));

  it("states it, and drops the 'until then' sentence", () => {
    expect(text).toContain("Bright Data keeps the snapshots it delivers to us for 30 days.");
    expect(text).not.toContain("Until then");
  });

  it("runs the copy gate over the rendered notice: a number without a claims row fails", () => {
    const deny = loadDenylist();
    const claims = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    const findings = checkCopy([{ text, line: 1 }], "notice", deny, claims);
    // "30" has no claims row yet: the F8 commit must add one with the vendor's written answer.
    expect(findings.map((f) => f.rule)).toContain(
      findings.find((f) => f.detail.includes("30"))?.rule ?? "missing",
    );
    // The notice as published today passes.
    const today = textOf(renderToStaticMarkup(<DataProviderNotice />));
    expect(checkCopy([{ text: today, line: 1 }], "notice", deny, claims)).toEqual([]);
  });
});

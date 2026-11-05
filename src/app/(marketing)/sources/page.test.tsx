import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadDenylist } from "../../../../compliance/lib/denylist.mjs";
import { checkCopy, claimNumbers } from "../../../../compliance/lib/scan-copy";
import { sources } from "@/sources/registry";
import type { CollectSource, Source } from "@/sources/types";
import { HOW, NEVER_COLLECTED, SourceList } from "../_components/source-list";
import SourcesPage from "./page";

/** The sources page (docs/PLAN.md M9): exactly the registry, with access, retention and vendor. */

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const page = text(renderToStaticMarkup(<SourcesPage />));
const collect = sources.filter((s): s is CollectSource => s.mode === "collect");

describe("sources page", () => {
  it("describes exactly the collect sources in the registry, no more and no fewer", () => {
    expect(Object.keys(HOW).sort()).toEqual(collect.map((s) => s.id).sort());
  });

  it.each(collect.map((s) => [s.id, s] as const))("%s: access, retention and status", (_, s) => {
    const block = text(renderToStaticMarkup(<SourceList sources={[s]} />));
    expect(block).toContain(s.displayName);
    expect(block).toContain(HOW[s.id]!);
    expect(block).toContain(`Deleted from AskedFor ${s.retentionDays} days after we collect it.`);
    expect(block).toMatch(/Collecting now\.|Not switched on yet\./);
    if (s.vendor) expect(block).toContain(`Data provider: ${s.vendor.name}.`);
  });

  it("says plainly that the Reddit vendor is not a data license, and how X is used", () => {
    expect(page).toContain("Through Bright Data");
    expect(page).toContain("This is not a data license from Reddit.");
    expect(page).toContain("off by default");
  });

  it("names every link source as a search the user opens, and every platform never collected", () => {
    for (const s of sources.filter((x) => x.mode === "link")) expect(page).toContain(s.displayName);
    for (const name of NEVER_COLLECTED) expect(page).toContain(name);
    expect(page).toContain("we never access Product Hunt");
  });

  it("shows a source as off when its kill switch is off", () => {
    const off = { ...collect[0]!, id: "nonexistent_source" } as Source;
    expect(text(renderToStaticMarkup(<SourceList sources={[off]} />))).toContain(
      "Not switched on yet.",
    );
  });

  it("passes the copy gate as rendered: every number has a claims row", () => {
    const claims = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    const findings = checkCopy([{ text: page, line: 1 }], "sources", loadDenylist(), claims);
    expect(findings).toEqual([]);
  });
});

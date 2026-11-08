import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadDenylist } from "../../../../compliance/lib/denylist.mjs";
import { checkCopy, claimNumbers } from "../../../../compliance/lib/scan-copy";
import { LAUNCH_COLLECT_SOURCES, sources } from "@/sources/registry";
import type { CollectSource, Source } from "@/sources/types";
import { HOW, NEVER_COLLECTED, SourceList } from "../_components/source-list";
import { unclaimedBlocks } from "../../../../compliance/lib/claims-blocks";
import SourcesPage, { metadata } from "./page";

const claimsText = readFileSync("docs/claims.md", "utf8");

/** The sources page (docs/PLAN.md M9): exactly the registry, with access, retention and vendor. */

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const page = text(renderToStaticMarkup(<SourcesPage />));
const collect = sources.filter(
  (s): s is CollectSource =>
    s.mode === "collect" && (LAUNCH_COLLECT_SOURCES as readonly string[]).includes(s.id),
);

describe("sources page", () => {
  it("describes exactly the launch collect sources, no more and no fewer (8 Nov 2026)", () => {
    expect(collect.map((s) => s.id).sort()).toEqual(["bluesky", "hackernews", "reddit"]);
    expect(Object.keys(HOW).sort()).toEqual(collect.map((s) => s.id).sort());
    const cards = renderToStaticMarkup(<SourcesPage />).match(/<h3[^>]*>[^<]*<\/h3>/g) ?? [];
    expect(cards.map((h) => h.replace(/<[^>]+>/g, "")).sort()).toEqual(
      ["Bluesky", "Hacker News", "Reddit"].sort(),
    );
  });

  it("says X is coming later, and lists no X collection", () => {
    expect(page).toContain("X is coming later.");
    expect(page).not.toContain("official X API");
  });

  it("marks Reddit as off until its paperwork with the vendor is done, and only then", () => {
    const reddit = collect.find((s) => s.id === "reddit")!;
    const line =
      "It stays off until our data processing agreement with Bright Data and our privacy impact assessment are signed.";
    const render = () => text(renderToStaticMarkup(<SourceList sources={[reddit]} />));
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SOURCE_REDDIT_ENABLED", "true");
    try {
      expect(render()).toContain("Not switched on yet.");
      expect(render()).toContain(line);
    } finally {
      vi.unstubAllEnvs();
    }
    // Switched off by its own switch where the vendor gate is cleared: no paperwork claim.
    vi.stubEnv("SOURCE_REDDIT_ENABLED", "false");
    try {
      expect(render()).toContain("Not switched on yet.");
      expect(render()).not.toContain(line);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(collect.map((s) => [s.id, s] as const))("%s: access, retention and status", (_, s) => {
    const block = text(renderToStaticMarkup(<SourceList sources={[s]} />));
    expect(block).toContain(s.displayName);
    expect(block).toContain(HOW[s.id]!);
    expect(block).toContain(`Deleted from AskedFor ${s.retentionDays} days after we collect it.`);
    expect(block).toMatch(/Switched on\.|Not switched on yet\./);
    if (s.vendor) expect(block).toContain(`Data provider: ${s.vendor.name}.`);
  });

  it("says plainly that the Reddit vendor is not a data license", () => {
    expect(page).toContain("Through Bright Data");
    expect(page).toContain("This is not a data license from Reddit.");
  });

  it("names every link source as a search the user opens, and every platform never collected", () => {
    for (const s of sources.filter((x) => x.mode === "link")) expect(page).toContain(s.displayName);
    for (const name of NEVER_COLLECTED) expect(page).toContain(name);
    expect(page).toContain("we never collect anything from Product Hunt");
  });

  it("shows a source as off when its kill switch is off, and leaves out a non-launch source", () => {
    vi.stubEnv("SOURCE_HACKERNEWS_ENABLED", "false");
    try {
      const off = collect.find((s) => s.id === "hackernews")! as Source;
      expect(text(renderToStaticMarkup(<SourceList sources={[off]} />))).toContain(
        "Not switched on yet.",
      );
    } finally {
      vi.unstubAllEnvs();
    }
    const planted = { ...collect[0]!, id: "x", displayName: "Planted" } as Source;
    expect(text(renderToStaticMarkup(<SourceList sources={[planted]} />))).not.toContain("Planted");
  });

  it("has a claims row for every paragraph, the cards' lines included", () => {
    const { blocks, missing } = unclaimedBlocks(renderToStaticMarkup(<SourcesPage />), ["p"]);
    expect(blocks.length).toBeGreaterThanOrEqual(15);
    expect(missing).toEqual([]);
    expect(claimsText).toContain(metadata.description as string);
  });

  it("passes the copy gate as rendered: every number has a claims row", () => {
    const claims = claimNumbers(readFileSync("docs/claims.md", "utf8"));
    const findings = checkCopy([{ text: page, line: 1 }], "sources", loadDenylist(), claims);
    expect(findings).toEqual([]);
  });
});

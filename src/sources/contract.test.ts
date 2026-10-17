import { describe, expect, it } from "vitest";
import { registryProblems, sources } from "./registry";
import type { CollectSource, Source } from "./types";

/**
 * Source contract v2 (docs/PLAN.md 7.1): every rule the registry enforces, each seen to fail on a
 * planted source.
 */

function collect(over: Partial<CollectSource> = {}): CollectSource {
  return {
    id: "hackernews",
    displayName: "Hacker News",
    mode: "collect",
    access: "official_api",
    termsUrl: "https://terms.example/hn",
    allowedHosts: ["api.hn.example"],
    linkHosts: ["news.hn.example"],
    dailyBudget: 50,
    retentionDays: 30,
    costPerUnitUsd: 0,
    start: async () => ({ kind: "done", posts: [], units: 0 }),
    ...over,
  };
}

const vendorReddit = (over: Partial<CollectSource> = {}) =>
  collect({
    id: "reddit",
    displayName: "Reddit",
    access: "vendor_api",
    vendor: {
      name: "Data vendor",
      dpaUrl: "https://vendor.example/dpa",
      dpaSignedOnEnv: "VENDOR_DPA_SIGNED_ON",
    },
    allowedHosts: ["api.vendor.example"],
    linkHosts: ["www.reddit.com"],
    retentionDays: 7,
    costPerUnitUsd: 0.0015,
    ...over,
  });

describe("registryProblems", () => {
  it("finds none in the real registry", () => {
    expect(registryProblems(sources)).toEqual([]);
  });

  it("accepts well-formed collect sources", () => {
    expect(registryProblems([collect(), vendorReddit()])).toEqual([]);
  });

  it.each<[string, Source[], RegExp]>([
    [
      "a vendor source without its vendor",
      [vendorReddit({ vendor: undefined })],
      /reddit: vendor_api needs a vendor/,
    ],
    [
      "a vendor DPA link that is not https",
      [
        vendorReddit({
          vendor: {
            name: "V",
            dpaUrl: "http://vendor.example/dpa",
            dpaSignedOnEnv: "V_DPA_SIGNED_ON",
          },
        }),
      ],
      /reddit: the vendor's DPA link must be https/,
    ],
    [
      "a vendor without a DPA date variable",
      [
        vendorReddit({
          vendor: { name: "V", dpaUrl: "https://vendor.example/dpa", dpaSignedOnEnv: "dpa date" },
        }),
      ],
      /reddit: the vendor's DPA date must live in an env var named <NAME>_DPA_SIGNED_ON/,
    ],
    [
      "vendor access on a source other than reddit",
      [
        collect({
          access: "vendor_api",
          vendor: { name: "V", dpaUrl: "https://v.example", dpaSignedOnEnv: "V_DPA_SIGNED_ON" },
        }),
      ],
      /hackernews: only reddit may use a vendor/,
    ],
    [
      "30-day retention for reddit",
      [vendorReddit({ retentionDays: 30 })],
      /reddit: retention must be 7 days/,
    ],
    [
      "30-day retention for x",
      [collect({ id: "x", retentionDays: 30 })],
      /x: retention must be 7 days/,
    ],
    [
      "7-day retention for hacker news",
      [collect({ retentionDays: 7 })],
      /hackernews: retention must be 30 days/,
    ],
    [
      "a platform's own site as an allowed host",
      [collect({ allowedHosts: ["www.reddit.com"] })],
      /hackernews: www\.reddit\.com is a platform's own site/,
    ],
    [
      "a link host that safeFetch would fetch",
      [collect({ linkHosts: ["api.hn.example"] })],
      /hackernews: link host api\.hn\.example is fetchable/,
    ],
    [
      "a link host another source may fetch",
      [collect(), vendorReddit({ linkHosts: ["api.hn.example"] })],
      /reddit: link host api\.hn\.example is fetchable/,
    ],
    [
      "a negative cost",
      [collect({ costPerUnitUsd: -1 })],
      /hackernews: cost and budget must not be negative/,
    ],
    ["a duplicate id", [collect(), collect()], /duplicate id hackernews/],
    [
      "a never-collected platform as a collect source",
      [collect({ id: "linkedin" })],
      /linkedin is never collected/,
    ],
  ])("catches %s (planted)", (_label, list, problem) => {
    expect(registryProblems(list).join("\n")).toMatch(problem);
  });
});

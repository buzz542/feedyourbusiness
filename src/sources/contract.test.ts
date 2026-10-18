import { describe, expect, it } from "vitest";
import { BRIGHTDATA_API_HOST } from "./reddit-vendor";
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
    credentials: [],
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
    allowedHosts: [BRIGHTDATA_API_HOST],
    linkHosts: ["www.reddit.com"],
    retentionDays: 7,
    costPerUnitUsd: 0.0015,
    credentials: ["DATAVENDOR_API_TOKEN", "REDDIT_PROVIDER"],
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
      /hackernews: cost and budget must be finite and not negative/,
    ],
    ["a duplicate id", [collect(), collect()], /duplicate id hackernews/],
    [
      "a never-collected platform as a collect source",
      [collect({ id: "linkedin" })],
      /linkedin is never collected/,
    ],
    [
      "a never-collected platform inside a source id",
      [collect({ id: "linkedin_jobs" })],
      /linkedin_jobs is never collected/,
    ],
    [
      "a source that is not reddit calling the vendor's host",
      [collect({ id: "forum", allowedHosts: [BRIGHTDATA_API_HOST] })],
      /forum: only reddit, with access vendor_api, may call the vendor/,
    ],
    [
      "the vendor's host under an official_api label",
      [vendorReddit({ access: "official_api", vendor: undefined })],
      /reddit: must declare access vendor_api and its vendor/,
    ],
    [
      "a vendor source calling a host outside the vendor",
      [vendorReddit({ allowedHosts: [BRIGHTDATA_API_HOST, "api.other.example"] })],
      /reddit: a vendor source may call only the vendor's hosts/,
    ],
    [
      "a credential that belongs to something else",
      [collect({ credentials: ["SUPABASE_SECRET_KEY"] })],
      /hackernews: credential SUPABASE_SECRET_KEY is not its own/,
    ],
    [
      "another vendor's credential",
      [vendorReddit({ credentials: ["STRIPE_SECRET_KEY"] })],
      /reddit: credential STRIPE_SECRET_KEY is not its own/,
    ],
    [
      "a credential named like a prefix trick",
      [collect({ id: "x", retentionDays: 7, credentials: ["XSUPABASE_SECRET_KEY"] })],
      /x: credential XSUPABASE_SECRET_KEY is not its own/,
    ],
    [
      "a required credential it may not read",
      [collect({ requiredCredentials: ["HACKERNEWS_TOKEN"] })],
      /hackernews: required credential HACKERNEWS_TOKEN is not in its credentials/,
    ],
    [
      "a cost that is not a finite number",
      [collect({ costPerUnitUsd: Number.NaN })],
      /hackernews: cost and budget must be finite and not negative/,
    ],
    [
      "an infinite budget",
      [collect({ dailyBudget: Number.POSITIVE_INFINITY })],
      /hackernews: cost and budget must be finite and not negative/,
    ],
    [
      "a link source's host that a collect source may fetch",
      [
        collect(),
        {
          id: "forum_links",
          displayName: "Forum",
          mode: "link",
          termsUrl: "https://terms.example/forum",
          allowedHosts: [],
          linkHosts: ["api.hn.example"],
          dailyBudget: 0,
          searchLinks: () => [],
        },
      ],
      /forum_links: link host api\.hn\.example is fetchable/,
    ],
  ])("catches %s (planted)", (_label, list, problem) => {
    expect(registryProblems(list).join("\n")).toMatch(problem);
  });
});

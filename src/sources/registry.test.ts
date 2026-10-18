import { describe, expect, it } from "vitest";
import {
  allowedHosts,
  declaredHosts,
  dpaSignedOn,
  enabledSources,
  isEnabled,
  killSwitchName,
  sources,
  vendorClearance,
} from "./registry";
import type { CollectSource } from "./types";
import { BRIGHTDATA_API_HOST } from "./reddit-vendor";

/**
 * Hard rules (docs/PLAN.md, section 2): these platforms are never collected, by us or by a vendor.
 * Reddit left this list on 14 Oct 2026 (decision D1): it is collected through a contracted data
 * vendor's API. compliance:hosts still guarantees we never fetch reddit.com ourselves.
 */
const NEVER_COLLECTED = [
  "indiehackers",
  "linkedin",
  "facebook",
  "instagram",
  "tiktok",
  "threads",
  "youtube",
  "discord",
];

describe("source registry", () => {
  it("has unique, well-formed ids", () => {
    const ids = sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("never lists a platform that the hard rules say is never collected as a collect source", () => {
    for (const source of sources) {
      if (NEVER_COLLECTED.includes(source.id)) expect(source.mode).toBe("link");
    }
  });

  it("does not list Product Hunt at all", () => {
    expect(sources.map((s) => s.id.toLowerCase())).not.toContain("producthunt");
    expect(declaredHosts().some((h) => h.includes("producthunt"))).toBe(false);
  });

  it("gives every source an https terms URL", () => {
    for (const source of sources) expect(new URL(source.termsUrl).protocol).toBe("https:");
  });

  it("allows no outbound host while every collect source is off (the default)", () => {
    expect(allowedHosts({})).toEqual([]);
    expect(allowedHosts({ SOURCE_REDDIT_LINKS_ENABLED: "true" })).toEqual([]);
  });

  it("allows a collect source's API hosts, and only those, once it is switched on", () => {
    expect(allowedHosts({ SOURCE_HACKERNEWS_ENABLED: "true" })).toEqual([
      "hn.algolia.com",
      "hacker-news.firebaseio.com",
    ]);
    expect(allowedHosts({ SOURCE_BLUESKY_ENABLED: "true" })).toEqual(["bsky.social"]);
    // Reddit: only the vendor's API host (D1), never a reddit.com host.
    expect(allowedHosts({ SOURCE_REDDIT_ENABLED: "true" })).toEqual([BRIGHTDATA_API_HOST]);
  });

  it("never allows a link host, even with every collect source on", () => {
    const all = Object.fromEntries(
      sources.filter((s) => s.mode === "collect").map((s) => [killSwitchName(s), "true"]),
    );
    const hosts = allowedHosts(all);
    for (const source of sources)
      for (const host of source.linkHosts) expect(hosts, host).not.toContain(host);
    expect(hosts).not.toContain("bsky.app");
  });

  it("keeps a search-link source for each platform users search themselves", () => {
    const linkIds = sources.filter((s) => s.mode === "link").map((s) => s.id);
    for (const id of ["reddit_links", "x_links", "linkedin", "facebook", "threads"])
      expect(linkIds).toContain(id);
  });

  it("keeps link sources fetch-free: no allowed hosts and a zero budget", () => {
    for (const source of sources.filter((s) => s.mode === "link")) {
      expect(source.allowedHosts).toEqual([]);
      expect(source.dailyBudget).toBe(0);
    }
  });
});

describe("kill switches", () => {
  const redditLinks = sources.find((s) => s.id === "reddit_links")!;

  it("derives the env name from the source id", () => {
    expect(killSwitchName({ id: "x_links" })).toBe("SOURCE_X_LINKS_ENABLED");
    expect(killSwitchName({ id: "reddit" })).toBe("SOURCE_REDDIT_ENABLED");
  });

  it("keeps link sources on unless explicitly set to false", () => {
    expect(isEnabled(redditLinks, {})).toBe(true);
    expect(isEnabled(redditLinks, { SOURCE_REDDIT_LINKS_ENABLED: "false" })).toBe(false);
    expect(isEnabled(redditLinks, { SOURCE_REDDIT_LINKS_ENABLED: "no" })).toBe(true);
  });

  it("can pause a link source", () => {
    const ids = enabledSources({ SOURCE_REDDIT_LINKS_ENABLED: "false" }).map((s) => s.id);
    expect(ids).not.toContain("reddit_links");
    expect(ids).toContain("linkedin");
  });

  it("keeps collect sources off unless set to exactly true", () => {
    const collect = {
      ...redditLinks,
      id: "reddit",
      mode: "collect" as const,
      allowedHosts: ["api.example.test"],
      dailyBudget: 1,
    };
    expect(isEnabled(collect as never, {})).toBe(false);
    expect(isEnabled(collect as never, { SOURCE_REDDIT_ENABLED: "1" })).toBe(false);
    expect(isEnabled(collect as never, { SOURCE_REDDIT_ENABLED: "true" })).toBe(true);
  });
});

describe("vendor clearance (docs/PLAN.md 2.1.7)", () => {
  const reddit = sources.find((s) => s.id === "reddit")! as CollectSource;
  const ON = { SOURCE_REDDIT_ENABLED: "true" };
  /** Reddit as it will be once the notice states Bright Data's snapshot retention (F8). */
  const stated: CollectSource = {
    ...reddit,
    vendor: { ...reddit.vendor!, snapshotRetention: "30 days" },
  };

  it("names the env var that holds the vendor's DPA date", () => {
    expect(reddit).toMatchObject({ vendor: { dpaSignedOnEnv: "BRIGHTDATA_DPA_SIGNED_ON" } });
  });

  it("keeps a vendor source off on any deployment until its DPA date is set", () => {
    for (const VERCEL_ENV of ["production", "preview"]) {
      expect(isEnabled(reddit, { ...ON, VERCEL_ENV })).toBe(false);
      expect(vendorClearance(reddit, { ...ON, VERCEL_ENV })).toBe("dpa_missing");
      expect(allowedHosts({ ...ON, VERCEL_ENV })).toEqual([]);
      for (const bad of [
        "",
        "soon",
        "2026-13-01",
        "2026-02-30",
        "02/11/2026",
        "2026-10-02T00:00:00Z",
      ])
        expect(
          isEnabled(reddit, { ...ON, VERCEL_ENV, BRIGHTDATA_DPA_SIGNED_ON: bad }),
          `${VERCEL_ENV} ${bad}`,
        ).toBe(false);
      const signed = { ...ON, VERCEL_ENV, BRIGHTDATA_DPA_SIGNED_ON: "2026-10-02" };
      expect(isEnabled(stated, signed)).toBe(true);
      expect(vendorClearance(stated, signed)).toBe("cleared");
    }
  });

  it("keeps it off, DPA or not, until the notice states how long the vendor keeps snapshots", () => {
    expect(reddit).toMatchObject({ vendor: { snapshotRetention: null } });
    for (const VERCEL_ENV of ["production", "preview"]) {
      const signed = { ...ON, VERCEL_ENV, BRIGHTDATA_DPA_SIGNED_ON: "2026-10-02" };
      expect(vendorClearance(reddit, signed)).toBe("notice_missing");
      expect(isEnabled(reddit, signed)).toBe(false);
      expect(allowedHosts(signed)).toEqual([]);
    }
  });

  it("fails closed when it cannot tell it is a local run", () => {
    const signed = { BRIGHTDATA_DPA_SIGNED_ON: "2026-10-01" };
    expect(vendorClearance(reddit, { NODE_ENV: "production" })).toBe("dpa_missing");
    expect(vendorClearance(stated, { NODE_ENV: "production", ...signed })).toBe("cleared");
    expect(vendorClearance(reddit, { VERCEL_ENV: "staging" })).toBe("dpa_missing");
    expect(vendorClearance(reddit, { VERCEL_ENV: "development" })).toBe("cleared");
    expect(vendorClearance(reddit, { NODE_ENV: "test" })).toBe("cleared");
  });

  it("refuses a DPA date in the future, so a date set ahead of signing clears nothing", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const on = (day: string) =>
      vendorClearance(stated, { VERCEL_ENV: "production", BRIGHTDATA_DPA_SIGNED_ON: day }, now);
    expect(on("2026-10-19")).toBe("dpa_missing");
    expect(on("2027-10-18")).toBe("dpa_missing");
    expect(on("2026-10-18")).toBe("cleared");
    expect(on(" 2026-10-01")).toBe("dpa_missing");
    expect(dpaSignedOn(reddit, { BRIGHTDATA_DPA_SIGNED_ON: "2026-10-19" }, now)).toBeNull();
    expect(dpaSignedOn(reddit, { BRIGHTDATA_DPA_SIGNED_ON: "2026-10-01" }, now)).toBe("2026-10-01");
  });

  it("does not hold back local runs or official API sources", () => {
    expect(isEnabled(reddit, ON)).toBe(true);
    expect(isEnabled(reddit, { ...ON, VERCEL_ENV: "development" })).toBe(true);
    const hn = sources.find((s) => s.id === "hackernews")!;
    expect(vendorClearance(hn, { VERCEL_ENV: "production" })).toBe("not_vendor");
    expect(isEnabled(hn, { VERCEL_ENV: "production", SOURCE_HACKERNEWS_ENABLED: "true" })).toBe(
      true,
    );
  });

  it("never turns on a vendor source whose kill switch is off, DPA or not", () => {
    expect(
      isEnabled(reddit, { VERCEL_ENV: "production", BRIGHTDATA_DPA_SIGNED_ON: "2026-10-02" }),
    ).toBe(false);
  });
});

describe("link sources", () => {
  const link = (id: string) => {
    const s = sources.find((x) => x.id === id);
    if (!s || s.mode !== "link") throw new Error(`no link source ${id}`);
    return s;
  };

  it("builds https search links on the declared host, newest first where supported", () => {
    const [first] = link("reddit_links").searchLinks(["invoice tool"]);
    expect(first?.url).toBe("https://www.reddit.com/search/?q=invoice%20tool&sort=new");
    expect(new URL(first!.url).hostname).toBe("www.reddit.com");
  });

  it("url-encodes terms so a term cannot inject parameters or change the host", () => {
    for (const source of sources.filter((s) => s.mode === "link")) {
      const [result] = source.searchLinks(["a&b=c#d/../e?f"]);
      const url = new URL(result!.url);
      expect(url.protocol).toBe("https:");
      expect(source.linkHosts).toContain(url.hostname);
      expect(url.hash).toBe("");
    }
  });

  it("drops blank terms and trims the rest", () => {
    expect(
      link("x_links")
        .searchLinks(["  ", "", "  crm  "])
        .map((l) => l.term),
    ).toEqual(["crm"]);
  });
});

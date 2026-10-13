import { describe, expect, it } from "vitest";
import {
  allowedHosts,
  declaredHosts,
  enabledSources,
  isEnabled,
  killSwitchName,
  sources,
} from "./registry";

/** Hard compliance rules: these platforms are never collected. */
const NEVER_COLLECTED = [
  "reddit",
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

  it("allows no outbound host at M0, because no collect source exists yet", () => {
    expect(allowedHosts({})).toEqual([]);
    expect(allowedHosts({ SOURCE_REDDIT_ENABLED: "true" })).toEqual([]);
  });

  it("keeps link sources fetch-free: no allowed hosts and a zero budget", () => {
    for (const source of sources.filter((s) => s.mode === "link")) {
      expect(source.allowedHosts).toEqual([]);
      expect(source.dailyBudget).toBe(0);
    }
  });
});

describe("kill switches", () => {
  const reddit = sources.find((s) => s.id === "reddit")!;

  it("derives the env name from the source id", () => {
    expect(killSwitchName({ id: "x_links" })).toBe("SOURCE_X_LINKS_ENABLED");
  });

  it("keeps link sources on unless explicitly set to false", () => {
    expect(isEnabled(reddit, {})).toBe(true);
    expect(isEnabled(reddit, { SOURCE_REDDIT_ENABLED: "false" })).toBe(false);
    expect(isEnabled(reddit, { SOURCE_REDDIT_ENABLED: "no" })).toBe(true);
  });

  it("can pause a link source", () => {
    const ids = enabledSources({ SOURCE_REDDIT_ENABLED: "false" }).map((s) => s.id);
    expect(ids).not.toContain("reddit");
    expect(ids).toContain("linkedin");
  });

  it("keeps collect sources off unless set to exactly true", () => {
    const collect = {
      ...reddit,
      mode: "collect" as const,
      allowedHosts: ["api.example.test"],
      dailyBudget: 1,
    };
    expect(isEnabled(collect as never, {})).toBe(false);
    expect(isEnabled(collect as never, { SOURCE_REDDIT_ENABLED: "1" })).toBe(false);
    expect(isEnabled(collect as never, { SOURCE_REDDIT_ENABLED: "true" })).toBe(true);
  });
});

describe("link sources", () => {
  const link = (id: string) => {
    const s = sources.find((x) => x.id === id);
    if (!s || s.mode !== "link") throw new Error(`no link source ${id}`);
    return s;
  };

  it("builds https search links on the declared host, newest first where supported", () => {
    const [first] = link("reddit").searchLinks(["invoice tool"]);
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

import { describe, expect, it } from "vitest";
import { linkSources, sources } from "@/sources/registry";
import { buildSearchLinks } from "./search-links";

const all = linkSources({});

describe("search links panel", () => {
  const groups = buildSearchLinks({
    sources: all,
    terms: ["invoice reminder & follow-up", "how do I chase #late invoices?"],
    subreddits: ["freelance", "SaaS"],
  });
  const declared = new Set(sources.flatMap((s) => s.linkHosts));

  it("every link is https on a declared link host", () => {
    const urls = groups.flatMap((g) => g.links.map((l) => new URL(l.url)));
    expect(urls.length).toBeGreaterThan(10);
    for (const url of urls) {
      expect(url.protocol).toBe("https:");
      expect(declared.has(url.hostname), url.hostname).toBe(true);
    }
  });

  it("encodes the term", () => {
    const urls = groups.flatMap((g) => g.links.map((l) => l.url));
    for (const url of urls) {
      expect(url).not.toContain(" ");
      expect(url).not.toContain("#late");
      expect(url).not.toMatch(/&follow-up/);
    }
    expect(urls.some((u) => u.includes(encodeURIComponent("how do I chase #late invoices?")))).toBe(
      true,
    );
  });

  it("covers Reddit, X, LinkedIn, Facebook, Threads and Indie Hackers", () => {
    expect(groups.map((g) => g.label)).toEqual(
      expect.arrayContaining(["Reddit", "X", "LinkedIn", "Facebook", "Threads", "Indie Hackers"]),
    );
  });

  it("adds subreddit searches restricted to the subreddit", () => {
    const sub = groups.find((g) => g.label === "Reddit · r/freelance")!;
    expect(sub.links[0]!.url).toMatch(
      /^https:\/\/www\.reddit\.com\/r\/freelance\/search\/\?q=.+&restrict_sr=1&sort=new$/,
    );
  });

  it("drops malformed, sensitive and profile subreddits", () => {
    const g = buildSearchLinks({
      sources: all,
      terms: ["x"],
      subreddits: ["../evil", "a", "depression", "u_someone", "ok_sub"],
    });
    expect(g.filter((x) => x.label.startsWith("Reddit · ")).map((x) => x.label)).toEqual([
      "Reddit · r/ok_sub",
    ]);
  });

  it("drops a platform whose kill switch is off", () => {
    const g = buildSearchLinks({
      sources: linkSources({ SOURCE_LINKEDIN_ENABLED: "false" }),
      terms: ["x"],
      subreddits: [],
    });
    expect(g.map((x) => x.label)).not.toContain("LinkedIn");
  });
});

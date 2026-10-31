import { describe, expect, it } from "vitest";
import { BRIGHTDATA_API_HOST } from "@/sources/reddit-vendor";
import { isPlatformHost, isPlatformWebHost } from "./platform-hosts";

/** docs/PLAN.md 7.1: a collect source's allowedHosts never holds a platform's own site. */
describe("isPlatformWebHost", () => {
  it.each([
    "www.reddit.com",
    "old.reddit.com",
    "oauth.reddit.com",
    "redd.it",
    "x.com",
    "www.x.com",
    "twitter.com",
    "bsky.app",
    "news.ycombinator.com",
    "www.linkedin.com",
    "www.producthunt.com",
    "WWW.REDDIT.COM.",
    "api.pullpush.io",
    "r.jina.ai",
    "web.archive.org",
    "nitter.net",
  ])("refuses %s", (host) => {
    expect(isPlatformWebHost(host)).toBe(true);
  });

  it.each([
    "api.x.com",
    "bsky.social",
    "hn.algolia.com",
    "hacker-news.firebaseio.com",
    BRIGHTDATA_API_HOST,
  ])("allows the official API host %s", (host) => {
    expect(isPlatformWebHost(host)).toBe(false);
  });
});

describe("isPlatformHost and the data vendor (docs/PLAN.md 12.3)", () => {
  it("refuses the vendor host and its subdomains, so fetchOwnSite never reaches it", () => {
    expect(isPlatformHost(BRIGHTDATA_API_HOST)).toBe(true);
    expect(isPlatformHost(`www.${BRIGHTDATA_API_HOST.split(".").slice(1).join(".")}`)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { isPlatformHost, PLATFORM_WEB_HOSTS } from "./platform-hosts";

/**
 * One shared list (docs/PLAN.md 2.1.10, 12.3): fetchOwnSite and the instant preview refuse every
 * platform host, its subdomains, and the proxies and caches that would reach a platform page.
 */
describe("isPlatformHost", () => {
  it.each([
    "www.reddit.com",
    "old.reddit.com",
    "reddit.com",
    "redd.it",
    "i.redd.it",
    "x.com",
    "t.co",
    "twitter.com",
    "www.linkedin.com",
    "lnkd.in",
    "facebook.com",
    "m.facebook.com",
    "fb.me",
    "instagram.com",
    "threads.net",
    "threads.com",
    "www.tiktok.com",
    "youtube.com",
    "youtu.be",
    "discord.com",
    "discord.gg",
    "bsky.app",
    "public.api.bsky.app",
    "bsky.social",
    "news.ycombinator.com",
    "hn.algolia.com",
    "hacker-news.firebaseio.com",
    "www.producthunt.com",
    "www.indiehackers.com",
    "api.brightdata.com",
    "www-reddit-com.translate.goog",
    "web.archive.org",
    "archive.org",
    "archive.ph",
    "archive.today",
    "webcache.googleusercontent.com",
    "WWW.REDDIT.COM",
    "www.reddit.com.",
  ])("refuses %s", (host) => {
    expect(isPlatformHost(host)).toBe(true);
  });

  it.each([
    "example.com",
    "myproduct.app",
    "notreddit.com",
    "reddit.com.example.com",
    "x.company",
    "tco.example",
    "algolia.com",
    "firebaseio.com",
    "googleusercontent.com",
    "translate.example",
  ])("allows %s, which is not a platform", (host) => {
    expect(isPlatformHost(host)).toBe(false);
  });

  it("covers every platform web host the hosts gate checks", () => {
    for (const host of PLATFORM_WEB_HOSTS) expect(isPlatformHost(host), host).toBe(true);
  });
});

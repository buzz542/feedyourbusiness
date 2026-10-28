import { describe, expect, it } from "vitest";
import { BRIGHTDATA_API_HOST } from "@/sources/reddit-vendor";
import { isPlatformHost, mentionsPlatform, PLATFORM_WEB_HOSTS } from "./platform-hosts";

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
    "media.licdn.com",
    "facebook.com",
    "m.facebook.com",
    "fb.me",
    "fb.watch",
    "m.me",
    "www.messenger.com",
    "connect.facebook.net",
    "instagram.com",
    "instagr.am",
    "scontent.cdninstagram.com",
    "threads.net",
    "threads.com",
    "www.tiktok.com",
    "p16.tiktokcdn.com",
    "api.tiktokv.com",
    "youtube.com",
    "youtu.be",
    "www.youtube-nocookie.com",
    "i.ytimg.com",
    "rr1.googlevideo.com",
    "discord.com",
    "discord.gg",
    "cdn.discordapp.com",
    "media.discordapp.net",
    "bsky.app",
    "public.api.bsky.app",
    "bsky.social",
    "morel.us-east.host.bsky.network",
    "news.ycombinator.com",
    "hn.algolia.com",
    "hacker-news.firebaseio.com",
    "www.producthunt.com",
    "www.indiehackers.com",
    BRIGHTDATA_API_HOST,
    "www-reddit-com.translate.goog",
    "web.archive.org",
    "archive.org",
    "archive.ph",
    "archive.today",
    "archive.is",
    "archive.li",
    "archive.vn",
    "archive.md",
    "archive.fo",
    "webcache.googleusercontent.com",
    "r.jina.ai",
    "12ft.io",
    "nitter.net",
    "xcancel.com",
    "fxtwitter.com",
    "vxtwitter.com",
    "fixupx.com",
    "rxddit.com",
    "vxreddit.com",
    "api.pullpush.io",
    "WWW.REDDIT.COM",
    "www.reddit.com.",
    "www.reddit.com..",
    "www.reddit.com...",
  ])("refuses %s", (host) => {
    expect(isPlatformHost(host)).toBe(true);
  });

  it.each([
    "www-reddit-com.cdn.ampproject.org",
    "reddit-com.some-proxy.example",
    "news-ycombinator-com.proxy.example",
    "x-com.mirror.example",
  ])("refuses %s, a platform domain written with dashes by a proxy", (host) => {
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
    "box-com.example",
    "mybsky.network.example",
  ])("allows %s, which is not a platform", (host) => {
    expect(isPlatformHost(host)).toBe(false);
  });

  it("covers every platform web host the hosts gate checks", () => {
    for (const host of PLATFORM_WEB_HOSTS) expect(isPlatformHost(host), host).toBe(true);
  });
});

describe("mentionsPlatform (a proxy that takes the target in its path or query)", () => {
  it.each([
    "/https://www.reddit.com/r/SaaS/",
    "/newest/https://www.reddit.com/",
    "/c/s/www.reddit.com/",
    "/?url=https://news.ycombinator.com/item?id=1",
    "/https%3A%2F%2Fwww.reddit.com%2Fr%2Fx",
    "/https%253A%252F%252Fx.com%252Fa",
    "/https://ｗｗｗ.ｒｅｄｄｉｔ.ｃｏｍ/r/x",
    "/https://www.reddit。com/r/x",
    "/https://WWW.LINKEDIN.COM/in/a",
    "/profile?u=bsky.app",
  ])("finds a platform in %s", (path) => {
    expect(mentionsPlatform(path)).toBe(true);
  });

  it.each([
    "/",
    "/pricing",
    "/blog/max.com-review",
    "/integrations/dropbox.com",
    "/compare/netflix.com",
    "/about/notreddit.com",
    "/%E0%A4%A",
  ])("finds none in %s", (path) => {
    expect(mentionsPlatform(path)).toBe(false);
  });
});

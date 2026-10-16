import { describe, expect, it } from "vitest";
import { BRIGHTDATA_API_HOST, BRIGHTDATA_DOMAIN } from "@/sources/reddit-vendor";
import {
  embedsPlatformUrl,
  isPlatformHost,
  isPlatformWebHost,
  PLATFORM_DOMAINS,
} from "./platform-hosts";

/** One shared list for fetchOwnSite() and the instant preview (docs/PLAN.md 2.1.10, 12.3). */
describe("isPlatformHost", () => {
  it("covers every domain the plan lists, the vendor included", () => {
    for (const domain of [
      "reddit.com",
      "redd.it",
      "redditmedia.com",
      "x.com",
      "twitter.com",
      "t.co",
      "linkedin.com",
      "lnkd.in",
      "facebook.com",
      "fb.com",
      "fb.me",
      "instagram.com",
      "threads.net",
      "threads.com",
      "tiktok.com",
      "youtube.com",
      "youtu.be",
      "discord.com",
      "discord.gg",
      "bsky.app",
      "bsky.social",
      "ycombinator.com",
      "hn.algolia.com",
      "hacker-news.firebaseio.com",
      "producthunt.com",
      "indiehackers.com",
      "translate.goog",
      "web.archive.org",
      "archive.org",
      "archive.ph",
      "archive.today",
      "webcache.googleusercontent.com",
      BRIGHTDATA_DOMAIN,
    ])
      expect(PLATFORM_DOMAINS, domain).toContain(domain);
  });

  it.each([
    "reddit.com",
    "www.reddit.com",
    "old.reddit.com",
    "WWW.REDDIT.COM",
    "www.reddit.com.",
    "reddit.com..",
    "public.api.bsky.app",
    "news.ycombinator.com",
    "www-reddit-com.translate.goog",
    "www-reddit-com.cdn.ampproject.org",
    "www-reddit-com.some-new-proxy.example",
    BRIGHTDATA_API_HOST,
    "m.youtube.com",
    "www.youtube-nocookie.com",
    "archive.is",
    "archive.li",
    "archive.vn",
    "archive.fo",
    "archive.md",
    "r.jina.ai",
    "12ft.io",
    "nitter.net",
    "xcancel.com",
    "fxtwitter.com",
    "rxddit.com",
    "instagr.am",
    "fb.watch",
    "api.x.com",
  ])("refuses %s", (host) => {
    expect(isPlatformHost(host)).toBe(true);
  });

  it.each([
    "notreddit.com",
    "reddit.com.evil.example",
    "box.com",
    "mythreads.com",
    "algolia.com",
    "example.com",
    "fix-com.example",
    "boxed.example",
  ])("allows %s", (host) => {
    expect(isPlatformHost(host)).toBe(false);
  });

  it("treats API hosts under a platform domain as API hosts, not web hosts", () => {
    expect(isPlatformHost("api.x.com")).toBe(true);
    expect(isPlatformWebHost("api.x.com")).toBe(false);
    expect(isPlatformWebHost("x.com")).toBe(true);
    expect(isPlatformWebHost("www.reddit.com")).toBe(true);
  });
});

describe("embedsPlatformUrl", () => {
  it.each([
    "https://reader.example/https://www.reddit.com/r/x",
    "https://cache.example/c/s/www.reddit.com/r/x",
    "https://snap.example/web/2026/https://x.com/a",
    "https://proxy.example/?u=https://www.reddit.com/r/x",
    "https://proxy.example/?u=https%3A%2F%2Fwww.reddit.com%2Fr%2Fx",
    "https://proxy.example/?u=https%253A%252F%252Fold.reddit.com",
    "https://proxy.example/search?q=cache:https://news.ycombinator.com/item?id=1",
    "https://proxy.example/%2F%2Fwww.linkedin.com%2Fin%2Fa",
  ])("refuses %s", (url) => {
    expect(embedsPlatformUrl(new URL(url))).toBe(true);
  });

  it.each([
    "https://invoicer.example/",
    "https://invoicer.example/pricing?plan=pro",
    "https://invoicer.example/?ref=producthunt",
    "https://invoicer.example/?utm_source=reddit.com",
    "https://invoicer.example/blog/why-reddit-users-love-us",
    "https://invoicer.example/docs/v1.2.3/setup",
  ])("allows %s", (url) => {
    expect(embedsPlatformUrl(new URL(url))).toBe(false);
  });
});

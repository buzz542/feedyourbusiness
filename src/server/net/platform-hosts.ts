import { BRIGHTDATA_DOMAIN } from "@/sources/reddit-vendor";

/**
 * Platform hosts (docs/PLAN.md 2.1.10, 12.3). fetchOwnSite and the instant preview refuse every
 * one of these and all their subdomains, API hosts included, because a user's product site is
 * never one of them. The proxies and caches at the end would reach a platform page indirectly.
 */
export const PLATFORM_DOMAINS: readonly string[] = [
  "reddit.com",
  "redd.it",
  "redditmedia.com",
  "redditstatic.com",
  "x.com",
  "twitter.com",
  "t.co",
  "twimg.com",
  "linkedin.com",
  "lnkd.in",
  "facebook.com",
  "fb.com",
  "fb.me",
  "fbcdn.net",
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
  BRIGHTDATA_DOMAIN,
  "translate.goog",
  "web.archive.org",
  "archive.org",
  "archive.ph",
  "archive.today",
  "webcache.googleusercontent.com",
];

/**
 * Web hosts of platforms we collect through an API: stored links point there, requests never do.
 * tests/compliance/hosts.test.ts checks no collect source allows any of them.
 */
export const PLATFORM_WEB_HOSTS: readonly string[] = [
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "bsky.app",
  "news.ycombinator.com",
  "indiehackers.com",
  "www.indiehackers.com",
];

const normalize = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

export function isPlatformHost(host: string): boolean {
  const h = normalize(host);
  return PLATFORM_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

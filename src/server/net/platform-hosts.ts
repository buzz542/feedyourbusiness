import { BRIGHTDATA_DOMAIN } from "@/sources/reddit-vendor";

/**
 * Platform hosts (docs/PLAN.md 2.1.10, 12.3). fetchOwnSite and the instant preview refuse every
 * one of these and all their subdomains, API and media hosts included, because a user's product
 * site is never one of them. The proxies, readers, caches and mirrors at the end would reach a
 * platform page indirectly; mentionsPlatform() catches the ones this list cannot name.
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
  "licdn.com",
  "facebook.com",
  "facebook.net",
  "fb.com",
  "fb.me",
  "fb.watch",
  "fbcdn.net",
  "m.me",
  "messenger.com",
  "instagram.com",
  "instagr.am",
  "cdninstagram.com",
  "threads.net",
  "threads.com",
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokv.com",
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "ytimg.com",
  "googlevideo.com",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "discordapp.net",
  "bsky.app",
  "bsky.social",
  "bsky.network",
  "ycombinator.com",
  "hn.algolia.com",
  "hacker-news.firebaseio.com",
  "producthunt.com",
  "indiehackers.com",
  BRIGHTDATA_DOMAIN,
  // Proxies, readers, caches and mirrors.
  "translate.goog",
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
  "pullpush.io",
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

/** Lowercase, no brackets, no trailing dots (a URL keeps "a.com..." as written). */
export const normalizeHost = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");

/** "reddit.com" as a proxy writes it into one label: "reddit-com", "www-reddit-com". */
const DASHED = PLATFORM_DOMAINS.map((d) => d.replace(/\./g, "-"));

export function isPlatformHost(host: string): boolean {
  const h = normalizeHost(host);
  if (PLATFORM_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  return h.split(".").some((label) => DASHED.some((d) => label === d || label.endsWith(`-${d}`)));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A platform domain standing alone: not inside a longer name such as max.com or notreddit.com. */
const MENTION = new RegExp(
  `(?<![a-z0-9-])(?:${PLATFORM_DOMAINS.map(escape).join("|")})(?![a-z0-9-])`,
);

function decode(text: string): string {
  let out = text;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  // Fold fullwidth letters and the ideographic full stops a proxy would read as ASCII.
  return out
    .normalize("NFKC")
    .replace(/[。．｡]/g, ".")
    .toLowerCase();
}

/**
 * Does a URL's path or query name a platform? A reader or proxy on an unlisted host takes the page
 * to fetch there ("/https://www.reddit.com/..."), so a host check alone would let it through.
 */
export function mentionsPlatform(pathAndQuery: string): boolean {
  return MENTION.test(decode(pathAndQuery));
}

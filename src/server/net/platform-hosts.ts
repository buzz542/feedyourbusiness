import { VENDOR_DOMAINS } from "@/sources/reddit-vendor";

/**
 * Platform hosts (docs/PLAN.md 2.1.10 and 12.3).
 *
 * The user's own site (`fetchOwnSite()`) and the instant preview must never become a way to reach
 * a platform. They refuse every domain below and all of its subdomains, API and media hosts
 * included, because a product's own site is never one of them, and any host that wraps one
 * (`www.reddit.com.proxy.example`, `www-reddit-com.translate.goog`).
 *
 * Sources are different: a collect source may call a platform's API host (Hacker News through
 * Algolia, Bluesky through its XRPC host) but never a platform's web host. `PLATFORM_WEB_HOSTS`
 * is that exact list, which the hosts gate checks against the registry.
 *
 * The data vendor's API host joins this list in M3, imported from the Reddit source module, the
 * only file allowed to name it (2.1.9).
 */

/** Platforms' own domains, every subdomain included. */
const PLATFORM_SITE_DOMAINS = [
  "reddit.com",
  "redd.it",
  "redditmedia.com",
  "redditstatic.com",
  "x.com",
  "twitter.com",
  "t.co",
  "twimg.com",
  "periscope.tv",
  "pscp.tv",
  "linkedin.com",
  "lnkd.in",
  "licdn.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "fb.watch",
  "fbcdn.net",
  "messenger.com",
  "m.me",
  "instagram.com",
  "instagr.am",
  "cdninstagram.com",
  "threads.net",
  "threads.com",
  "tiktok.com",
  "tiktokcdn.com",
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "ytimg.com",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "discordapp.net",
  "discord.media",
  "bsky.app",
  "bsky.social",
  "bsky.network",
  "ycombinator.com",
  "producthunt.com",
  "indiehackers.com",
] as const;

/** API hosts of platforms on other domains. */
/**
 * Official API hosts of platforms we collect, and the Reddit data vendor's domain (imported from the
 * Reddit module, the only file allowed to name it, 12.3): never a user's own site.
 */
const PLATFORM_API_DOMAINS = ["hn.algolia.com", "hacker-news.firebaseio.com", ...VENDOR_DOMAINS];

/** Proxies, readers, translators, archives and caches that would fetch a page for us. */
const PLATFORM_PROXY_DOMAINS = [
  "translate.goog",
  "r.jina.ai",
  "12ft.io",
  "smry.ai",
  "removepaywall.com",
  "archive.org",
  "archive-it.org",
  "archive.ph",
  "archive.today",
  "archive.is",
  "archive.li",
  "archive.md",
  "archive.vn",
  "archive.fo",
  "ghostarchive.org",
  "webcache.googleusercontent.com",
] as const;

/** Sites that republish platform posts: front ends, viewers and Reddit archives. */
const PLATFORM_MIRROR_DOMAINS = [
  "nitter.net",
  "nitter.poast.org",
  "xcancel.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
  "twstalker.com",
  "sotwe.com",
  "pullpush.io",
  "pushshift.io",
  "photon-reddit.com",
  "reveddit.com",
  "unddit.com",
  "redlib.net",
  "teddit.net",
  "safereddit.com",
  "rxddit.com",
  "vxreddit.com",
  "piped.video",
  "invidious.io",
  "yewtu.be",
  "picuki.com",
  "imginn.com",
  "ddinstagram.com",
  "urlebird.com",
] as const;

/** Every refused domain, as bare domains. */
export const PLATFORM_DOMAINS: readonly string[] = [
  ...PLATFORM_SITE_DOMAINS,
  ...PLATFORM_API_DOMAINS,
  ...PLATFORM_PROXY_DOMAINS,
  ...PLATFORM_MIRROR_DOMAINS,
];

/** Platforms' web hosts, exactly. Links point here; no request from AskedFor ever does. */
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

const normalize = (host: string): string =>
  host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");

/** True for a domain in `domains` or any subdomain of one. */
export const matchesDomain = (host: string, domains: readonly string[]): boolean => {
  const h = normalize(host);
  return h !== "" && domains.some((d) => h === d || h.endsWith(`.${d}`));
};

/**
 * True for a platform domain or any subdomain of one, and for a host that wraps one: the domain
 * followed by more labels (`www.reddit.com.proxy.example`), or the domain with its dots turned into
 * hyphens as a whole label or a label's end (`www-reddit-com.proxy.example`).
 */
export function isPlatformHost(host: string): boolean {
  const h = normalize(host);
  if (matchesDomain(h, PLATFORM_DOMAINS)) return true;
  const labels = h.split(".");
  return PLATFORM_DOMAINS.some((d) => {
    if (h.startsWith(`${d}.`) || h.includes(`.${d}.`)) return true;
    const hyphenated = d.replace(/\./g, "-");
    return labels.some((l) => l === hyphenated || l.endsWith(`-${hyphenated}`));
  });
}

/**
 * Site domains whose every host is a platform's own site: no official API we use lives under them.
 * X and Bluesky are left out because their official APIs live on their own domains (api.x.com,
 * bsky.social); their web hosts are in PLATFORM_WEB_HOSTS.
 */
const NO_API_SITE_DOMAINS: readonly string[] = PLATFORM_SITE_DOMAINS.filter(
  (d) =>
    ![
      "x.com",
      "twitter.com",
      "t.co",
      "twimg.com",
      "bsky.app",
      "bsky.social",
      "bsky.network",
    ].includes(d),
);

/**
 * True for a platform's own web site (a page people read), as opposed to an official API host a
 * collect source may call (docs/PLAN.md 7.1: no `allowedHosts` entry is a platform's own site).
 */
export function isPlatformWebHost(host: string): boolean {
  const h = normalize(host);
  return (
    PLATFORM_WEB_HOSTS.includes(h) ||
    matchesDomain(h, NO_API_SITE_DOMAINS) ||
    // Proxies, caches and mirrors that reach a platform's pages indirectly are never a source.
    matchesDomain(h, PLATFORM_PROXY_DOMAINS) ||
    matchesDomain(h, PLATFORM_MIRROR_DOMAINS)
  );
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A matcher for any of `domains` written in free text, at word boundaries. A subdomain needs no
 * extra pattern: the dot before the domain is itself a boundary. No nested quantifier, so it runs
 * in linear time on long input.
 */
export function domainMention(domains: readonly string[]): RegExp {
  return new RegExp(`(^|[^a-z0-9-])(?:${domains.map(escape).join("|")})($|[^a-z0-9-])`, "i");
}

/**
 * Decode up to three times, so double-encoded tricks cannot hide a host, then fold Unicode
 * lookalikes (fullwidth letters, ideographic full stops) the way a URL parser would.
 */
export function decodeForChecks(text: string): string {
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
  return out.normalize("NFKC").replace(/[\u3002\uff0e\uff61]/g, ".");
}

/** A URL's path and query, decoded for checks. */
export const decodedPathAndQuery = (url: URL): string =>
  decodeForChecks(`${url.pathname}${url.search}`);

const PLATFORM_MENTION = domainMention(PLATFORM_DOMAINS);

/**
 * True when a URL's path or query names a platform domain, as reader proxies and archives do
 * (`https://proxy.example/https://www.reddit.com/r/x`). Such a URL is refused whatever its host.
 */
export function mentionsPlatformHost(url: URL): boolean {
  return PLATFORM_MENTION.test(decodedPathAndQuery(url));
}

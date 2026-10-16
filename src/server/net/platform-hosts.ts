import { BRIGHTDATA_DOMAIN } from "@/sources/reddit-vendor";

/**
 * Platform domains (docs/PLAN.md 2.1.10, 12.3), shared by fetchOwnSite() and the instant preview so
 * neither becomes a way to fetch a platform. A user's product site is never one of these, so every
 * subdomain is refused, API hosts included, along with proxies and caches that would reach a
 * platform page indirectly.
 */
/** Platforms' own sites. No source may ever fetch these; links point there, requests never do. */
export const PLATFORM_WEB_DOMAINS: readonly string[] = [
  // Reddit
  "reddit.com",
  "redd.it",
  "redditmedia.com",
  "redditstatic.com",
  "reddituploads.com",
  // X
  "x.com",
  "twitter.com",
  "t.co",
  "twimg.com",
  "twttr.com",
  // LinkedIn
  "linkedin.com",
  "lnkd.in",
  "licdn.com",
  // Meta
  "facebook.com",
  "facebook.net",
  "fb.com",
  "fb.me",
  "fb.watch",
  "fbcdn.net",
  "fbsbx.com",
  "m.me",
  "messenger.com",
  "instagram.com",
  "instagr.am",
  "cdninstagram.com",
  "threads.net",
  "threads.com",
  // Others never collected
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokv.com",
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "ytimg.com",
  "googlevideo.com",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "discordapp.net",
  "producthunt.com",
  "indiehackers.com",
  // Collected through official APIs (below), never fetched as pages
  "bsky.app",
  "ycombinator.com",
  // Proxies, caches, archives and readers that would reach a platform page indirectly
  "translate.goog",
  "cdn.ampproject.org",
  "webcache.googleusercontent.com",
  "web.archive.org",
  "archive.org",
  "archive.ph",
  "archive.today",
  "archive.is",
  "archive.li",
  "archive.vn",
  "archive.fo",
  "archive.md",
  "ghostarchive.org",
  "r.jina.ai",
  "12ft.io",
  "nitter.net",
  "xcancel.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
  "rxddit.com",
  "vxreddit.com",
  "ddinstagram.com",
];

/** API and vendor hosts. Collect sources may call these; a user's own site is never one of them. */
export const PLATFORM_API_DOMAINS: readonly string[] = [
  "api.x.com",
  "api.twitter.com",
  "bsky.social",
  "bsky.network",
  "hn.algolia.com",
  "hacker-news.firebaseio.com",
  BRIGHTDATA_DOMAIN,
];

export const PLATFORM_DOMAINS: readonly string[] = [
  ...PLATFORM_WEB_DOMAINS,
  ...PLATFORM_API_DOMAINS,
];

const normalize = (host: string) => host.trim().toLowerCase().replace(/\.+$/, "");

const inDomains = (host: string, domains: readonly string[]) => {
  const h = normalize(host);
  return domains.some((domain) => h === domain || h.endsWith(`.${domain}`));
};

/** Platform domains written the way proxies put them into one label: "www-reddit-com". */
const DASHED = PLATFORM_WEB_DOMAINS.map((domain) => domain.replaceAll(".", "-"));

const hasDashedPlatformLabel = (host: string) =>
  normalize(host)
    .split(".")
    .slice(0, -1)
    .some((label) => DASHED.some((d) => label === d || label.endsWith(`-${d}`)));

/** Refused by fetchOwnSite() and the instant preview: every platform, its APIs and proxies. */
export const isPlatformHost = (host: string): boolean =>
  inDomains(host, PLATFORM_DOMAINS) || hasDashedPlatformLabel(host);

/**
 * A platform's own site, which no source may call (the hosts gate checks every allowedHosts). API
 * hosts under a platform domain (api.x.com) are not web hosts.
 */
export const isPlatformWebHost = (host: string): boolean =>
  inDomains(host, PLATFORM_WEB_DOMAINS) && !inDomains(host, PLATFORM_API_DOMAINS);

const HOST_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?(:\d+)?$/i;

/**
 * True when a URL names a platform inside its path or query, the way readers, archives and
 * proxies do (`/https://www.reddit.com/r/x`, `/c/s/www.reddit.com/...`, `?u=https://x.com/...`),
 * so a proxy missing from the list above still cannot fetch a platform page for us.
 */
export function embedsPlatformUrl(url: URL): boolean {
  const decode = (text: string) => {
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
    return out;
  };
  const isPlatformSegment = (segment: string) =>
    HOST_LIKE.test(segment) && isPlatformHost(segment.replace(/:\d+$/, ""));
  if (decode(url.pathname).split("/").some(isPlatformSegment)) return true;
  for (const value of url.searchParams.values()) {
    const decoded = decode(value);
    if (!decoded.includes("//")) continue;
    if (decoded.split(/[/?#&=\s]/).some(isPlatformSegment)) return true;
  }
  return false;
}

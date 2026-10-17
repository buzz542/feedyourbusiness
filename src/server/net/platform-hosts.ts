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

/** Lowercase, Unicode full stops (U+3002, U+FF0E, U+FF61) read as ".", trailing dots dropped. */
const normalize = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/[\u3002\uff0e\uff61]/g, ".")
    .replace(/\.+$/, "");

const inDomains = (host: string, domains: readonly string[]) => {
  const h = normalize(host);
  return domains.some((domain) => h === domain || h.endsWith(`.${domain}`));
};

/**
 * Platform domains the way proxies fold them into one label: "www-reddit-com", and Google's form,
 * which doubles existing hyphens first ("hacker--news-firebaseio-com").
 */
const DASHED = [
  ...new Set(
    PLATFORM_DOMAINS.flatMap((domain) => [
      domain.replaceAll(".", "-"),
      domain.replaceAll("-", "--").replaceAll(".", "-"),
    ]),
  ),
];

const hasDashedPlatformLabel = (host: string) =>
  normalize(host)
    .split(".")
    .slice(0, -1)
    .some((label) => DASHED.some((d) => label === d || label.endsWith(`-${d}`)));

/**
 * A platform domain followed by two or more labels, the way suffix proxies name hosts
 * ("www.reddit.com.proxy.example"). One extra label is left alone: "x.com.au" is another domain.
 */
const hasPlatformInside = (host: string) => {
  const labels = normalize(host).split(".");
  return PLATFORM_DOMAINS.some((domain) => {
    const parts = domain.split(".");
    for (let i = 0; i + parts.length + 2 <= labels.length; i++)
      if (parts.every((part, k) => labels[i + k] === part)) return true;
    return false;
  });
};

/** Refused by fetchOwnSite() and the instant preview: every platform, its APIs and proxies. */
export const isPlatformHost = (host: string): boolean =>
  inDomains(host, PLATFORM_DOMAINS) || hasDashedPlatformLabel(host) || hasPlatformInside(host);

/**
 * A platform's own site, which no source may call (the hosts gate checks every allowedHosts). API
 * hosts under a platform domain (api.x.com) are not web hosts.
 */
export const isPlatformWebHost = (host: string): boolean =>
  inDomains(host, PLATFORM_WEB_DOMAINS) && !inDomains(host, PLATFORM_API_DOMAINS);

const HOST_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A host written inside a path or query: userinfo and port dropped, then a platform domain? */
function namesPlatform(token: string): boolean {
  const host = normalize(token.slice(token.lastIndexOf("@") + 1).replace(/:\d*$/, ""));
  // No dashed-label rule here: a blog slug such as "leaving-reddit-com" is not a host.
  return HOST_NAME.test(host) && (inDomains(host, PLATFORM_DOMAINS) || hasPlatformInside(host));
}

function decodeAll(text: string): string {
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
  // Backslashes act as slashes in URL parsers; Unicode full stops act as dots in host names.
  return out.replace(/\\/g, "/").replace(/[\u3002\uff0e\uff61]/g, ".");
}

/** "https://host", "https:/host" and "//host" anywhere in the text. */
const EMBEDDED_HOST = /(?:[a-z][a-z0-9+.-]*:\/+|\/\/+)([^/?#&=;\s]+)/gi;

/**
 * True when a URL names a platform inside its path or query, the way readers, archives and
 * proxies do (`/https://www.reddit.com/r/x`, `/www.reddit.com/r/x`, `?https://x.com/a`,
 * `?url=www.reddit.com/r/x`, with any percent-encoding, backslashes, userinfo or Unicode dots), so
 * a proxy missing from the lists above still cannot fetch a platform page for us. A platform name
 * as the last path segment ("/docs/archive.md", "/channels/x.com") or a bare query value
 * ("?utm_source=reddit.com") is not a URL and stays allowed.
 */
export function embedsPlatformUrl(url: URL): boolean {
  const path = decodeAll(url.pathname);
  const query = decodeAll(url.search);
  for (const match of `${path} ${query}`.matchAll(EMBEDDED_HOST))
    if (namesPlatform(match[1] ?? "")) return true;
  if (path.split("/").slice(0, -1).some(namesPlatform)) return true;
  for (const [key, value] of url.searchParams)
    for (const part of [key, value]) {
      const text = decodeAll(part);
      if (text.includes("/") && namesPlatform(text.split("/")[0] ?? "")) return true;
    }
  return false;
}

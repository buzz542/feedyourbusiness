import { BRIGHTDATA_DOMAIN } from "@/sources/reddit-vendor";

/**
 * Platform domains (docs/PLAN.md 2.1.10, 12.3), shared by fetchOwnSite() and the instant preview so
 * neither becomes a way to fetch a platform. A user's product site is never one of these, so every
 * subdomain is refused, API hosts included, along with proxies and caches that would reach a
 * platform page indirectly.
 */
/** Proxies, caches, archives and readers that would reach a platform page indirectly. */
const PROXY_DOMAINS: readonly string[] = [
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

/**
 * Platforms' own sites, and the proxies that reach them. No source may ever fetch these; links
 * point there, requests never do.
 */
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
  ...PROXY_DOMAINS,
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

/**
 * The host a WHATWG URL parser reads from `text`: the parser readers, archives and CORS proxies run.
 * It applies everything a hand-written match misses: a missing "//" after a special scheme
 * ("https:www.reddit.com"), userinfo with any punctuation, percent-encoding and UTS46 mapping in
 * the host (fullwidth letters, soft hyphens), and stripped tabs and newlines. Null when none.
 */
function parsedHost(text: string, base?: string): string | null {
  try {
    return new URL(text, base).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Bare and "//" hosts are read as scheme-relative URLs against a fixed https base, exactly as
 * "https://host" would be, without building a URL from a variable host. Never fetched.
 */
const PARSE_BASE = "https://askedfor.app/";

/** A platform domain, or one inside a suffix proxy's host. No dashed-label rule: slugs are not hosts. */
const namesPlatform = (host: string | null): host is string =>
  host !== null && (inDomains(host, PLATFORM_DOMAINS) || hasPlatformInside(host));

/**
 * A platform host with a subdomain in front ("old.reddit.com", "news.ycombinator.com"): a host,
 * where a two-label name can be a file name or a label ("/channels/x.com"). Proxy and archive
 * domains are left out: "/docs/2026.archive.md" is a markdown file, and a bare archive host names
 * no platform page.
 */
const isSubdomainHost = (host: string) =>
  normalize(host).split(".").length >= 3 && !inDomains(host, PROXY_DOMAINS);

/** A host written bare, the way a path segment or a query value carries it. */
const bareHost = (text: string) => (text ? parsedHost(`//${text}`, PARSE_BASE) : null);

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

/** Where a URL may start inside other text: a scheme ("https:", "foo:") or a "//". */
const URL_START = /[a-z][a-z0-9+.-]*:|\/\//gi;

/** True when any URL starting inside `text` has a platform host. */
function embedsPlatform(text: string): boolean {
  for (const match of text.matchAll(URL_START)) {
    const rest = text.slice(match.index);
    if (namesPlatform(match[0] === "//" ? parsedHost(rest, PARSE_BASE) : parsedHost(rest)))
      return true;
  }
  return false;
}

/**
 * True when a URL names a platform inside its path or query, the way readers, archives and
 * proxies do (`/https://www.reddit.com/r/x`, `/https:www.reddit.com`, `/www.reddit.com`,
 * `?url=https://a&b@www.reddit.com/r/x`, with any percent-encoding, backslashes, userinfo,
 * Unicode dots or mapped letters), so a proxy missing from the lists above still cannot fetch a
 * platform page for us. A two-label platform name as the last of several path segments
 * ("/channels/x.com") or a bare query value ("?utm_source=reddit.com") is a file name or a label,
 * not a URL, and stays allowed.
 */
export function embedsPlatformUrl(url: URL): boolean {
  const path = decodeAll(url.pathname);
  if (embedsPlatform(path) || embedsPlatform(decodeAll(url.search))) return true;

  const segments = path.split("/").filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    const host = bareHost(segment);
    if (!namesPlatform(host)) continue;
    const last = index === segments.length - 1;
    // "/www.reddit.com", "/x.com" (a reader's whole path) and "/fetch/old.reddit.com" are hosts.
    if (!last || segments.length === 1 || isSubdomainHost(host)) return true;
  }

  for (const [key, value] of url.searchParams)
    for (const part of [key, value]) {
      const text = decodeAll(part);
      if (embedsPlatform(text)) return true;
      const host = bareHost(text.split("/")[0] ?? "");
      if (namesPlatform(host) && (text.includes("/") || isSubdomainHost(host))) return true;
    }
  return false;
}

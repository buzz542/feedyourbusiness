/**
 * Platform hosts (docs/PLAN.md 2.1.10 and 12.3): the one shared list that fetchOwnSite() and the
 * instant preview refuse, so neither becomes a way to fetch a platform.
 *
 * A host is a platform host when it is one of these domains or any subdomain of one, API hosts
 * included. Collect sources reach some of the API hosts (Hacker News, Bluesky, X) through
 * safeFetch() and the registry; nothing reaches them through fetchOwnSite(). The data vendor's host
 * joins this list in M3, imported from the Reddit module, which is the only file allowed to name it.
 */

export const PLATFORM_DOMAINS: readonly string[] = [
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
  // LinkedIn
  "linkedin.com",
  "lnkd.in",
  "licdn.com",
  // Meta
  "facebook.com",
  "fb.com",
  "fb.me",
  "fb.watch",
  "fbcdn.net",
  "messenger.com",
  "m.me",
  "instagram.com",
  "instagr.am",
  "ig.me",
  "cdninstagram.com",
  "threads.net",
  "threads.com",
  // TikTok
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokv.com",
  "tiktokapis.com",
  // YouTube
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "ytimg.com",
  "googlevideo.com",
  "youtube.googleapis.com",
  "youtubei.googleapis.com",
  // Discord
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "discordapp.net",
  // Bluesky
  "bsky.app",
  "bsky.social",
  "bsky.network",
  "bsky.chat",
  "plc.directory",
  // Hacker News
  "ycombinator.com",
  "hn.algolia.com",
  "hacker-news.firebaseio.com",
  // Product Hunt, Indie Hackers
  "producthunt.com",
  "indiehackers.com",
  // Proxies, readers and caches that would reach a platform page indirectly
  "translate.goog",
  "webcache.googleusercontent.com",
  "archive.org",
  "archive.ph",
  "archive.today",
  "archive.is",
  "archive.li",
  "archive.md",
  "archive.vn",
  "archive.fo",
  "ghostarchive.org",
  "cachedview.nl",
  "r.jina.ai",
  "12ft.io",
  // Sites that republish platform posts: front ends, viewers, downloaders and archives
  "nitter.net",
  "nitter.poast.org",
  "xcancel.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
  "fixvx.com",
  "twstalker.com",
  "threadreaderapp.com",
  "teddit.net",
  "reveddit.com",
  "unddit.com",
  "removeddit.com",
  "rxddit.com",
  "vxreddit.com",
  "redditsearch.io",
  "pullpush.io",
  "pushshift.io",
  "photon-reddit.com",
  "safereddit.com",
  "yewtu.be",
  "invidious.io",
  "inv.nadeko.net",
  "piped.video",
  "picuki.com",
  "imginn.com",
  "dumpor.com",
  "ddinstagram.com",
  "gramhir.com",
  "urlebird.com",
  "fxbsky.app",
  "skyview.social",
  "clearsky.app",
  "hckrnews.com",
  "hackerweb.app",
  "hnrss.org",
];

/**
 * The web hosts where posts live and where stored links point. Nothing in AskedFor requests them,
 * through any wrapper. The hosts gate reuses this list to check that no source allows one.
 */
export const PLATFORM_WEB_HOSTS: readonly string[] = [
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "redd.it",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "linkedin.com",
  "www.linkedin.com",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "threads.net",
  "www.threads.net",
  "threads.com",
  "www.threads.com",
  "tiktok.com",
  "www.tiktok.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "discord.com",
  "bsky.app",
  "news.ycombinator.com",
  "producthunt.com",
  "www.producthunt.com",
  "indiehackers.com",
  "www.indiehackers.com",
];

/** Lowercase, without trailing dots (`reddit.com..` is `reddit.com`). */
export const normalizeHost = (host: string): string => host.toLowerCase().replace(/\.+$/, "");

/**
 * Host labels of self-hosted front-end software that republishes platform posts (Nitter for X,
 * Redlib, Libreddit and Teddit for Reddit, Invidious and Piped for YouTube, ProxiTok for TikTok).
 * Instances run on anyone's domain, so the label is the signal: `nitter.example.net`,
 * `redlib.example`, `piped.example`. Piped matches only as a whole label, so `pipedrive.com` is fine.
 */
const FRONT_END_LABEL =
  /^(?:nitter|redlib|libreddit|teddit|invidious|proxitok)[a-z0-9-]*$|^(?:piped|pipedapi|pipedproxy)(?:-[a-z0-9-]+)?$/;

/** A platform domain written into one host label, as proxies do: `www-reddit-com.<proxy>`. */
const HYPHENATED_DOMAINS = PLATFORM_DOMAINS.map((d) => d.replaceAll(".", "-"));

/**
 * True for a platform domain or any subdomain of one, for a host with a front-end software label,
 * and for a host with a label that spells a platform domain with hyphens.
 */
export function isPlatformHost(host: string): boolean {
  const h = normalizeHost(host);
  if (PLATFORM_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  return h
    .split(".")
    .some(
      (label) =>
        FRONT_END_LABEL.test(label) ||
        HYPHENATED_DOMAINS.some((d) => label === d || label.endsWith(`-${d}`)),
    );
}

const DOMAIN_CHAR = /[a-z0-9-]/;

/** Decodes one run of `%XX` escapes: as UTF-8 when it is valid, byte by byte otherwise. */
function decodeRun(run: string): string {
  try {
    return decodeURIComponent(run);
  } catch {
    return run.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
}

/**
 * Percent-decodes until the text stops changing (at most 5 rounds), so nesting cannot hide, then
 * folds compatibility forms (NFKC: fullwidth letters and dots) and ideographic full stops to ASCII.
 * Each run of escapes is decoded on its own, so one malformed `%` cannot switch decoding off.
 */
export function decodeFully(text: string): string {
  let current = text;
  for (let round = 0; round < 5; round++) {
    const next = current.replace(/(?:%[0-9a-f]{2})+/gi, decodeRun);
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC").replace(/[。．｡]/g, ".");
}

/**
 * True for a path shaped like a platform's own pages, as a front-end copy on an unlisted domain
 * serves them: a subreddit or thread (`/r/<name>`, `/comments/<id>`), an X post
 * (`/<name>/status/<id>`), a YouTube video (`/watch?v=`, `/shorts/<id>`).
 */
export function hasPlatformShapedPath(url: URL): boolean {
  const path = decodeFully(url.pathname).toLowerCase();
  return (
    /^\/r\/[a-z0-9_]{2,21}(\/|$)/.test(path) ||
    /\/comments\/[a-z0-9]{5,}(\/|$)/.test(path) ||
    /\/status(?:es)?\/\d{5,}(\/|$)/.test(path) ||
    /^\/shorts\/[a-z0-9_-]{6,}(\/|$)/.test(path) ||
    (path === "/watch" && url.searchParams.has("v"))
  );
}

/**
 * True when the path or query names a platform domain, as a reader proxy or an archive link does
 * (`/https://www.reddit.com/r/x`, `?url=x.com%2Fname`), however many times it is encoded.
 * A domain counts only as a whole name: `acmex.com` does not name `x.com`.
 */
export function namesPlatformDomain(url: URL): boolean {
  const text = decodeFully(`${url.pathname}${url.search}`).toLowerCase();
  return PLATFORM_DOMAINS.some((domain) => {
    let from = 0;
    for (;;) {
      const at = text.indexOf(domain, from);
      if (at === -1) return false;
      const before = text[at - 1];
      const after = text[at + domain.length];
      if ((!before || !DOMAIN_CHAR.test(before)) && (!after || !DOMAIN_CHAR.test(after))) {
        return true;
      }
      from = at + 1;
    }
  });
}

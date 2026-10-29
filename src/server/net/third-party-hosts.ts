import { decodeFully, normalizeHost } from "./platform-hosts";

/**
 * Third-party hosts (docs/PLAN.md 4.3 and 12.3): sites that are someone else's, full of reviewers',
 * contributors' and posters' names, so fetchOwnSite() never reads them even when a user pastes
 * one. A host matches when it is one of these or any subdomain of one.
 *
 * Site hosting services (github.io, vercel.app, netlify.app, pages.dev and the like) are not on
 * this list: they serve the user's own site.
 */

export const THIRD_PARTY_HOSTS = {
  /** App stores, extension stores and marketplaces. */
  stores: [
    "apps.apple.com",
    "itunes.apple.com",
    "play.google.com",
    "chromewebstore.google.com",
    "chrome.google.com",
    "addons.mozilla.org",
    "microsoftedge.microsoft.com",
    "apps.microsoft.com",
    "appsource.microsoft.com",
    "marketplace.visualstudio.com",
    "plugins.jetbrains.com",
    "apps.shopify.com",
    "marketplace.atlassian.com",
    "appexchange.salesforce.com",
    "wordpress.org",
    "store.steampowered.com",
    "itch.io",
    "amazon.com",
    "amazon.co.uk",
    "etsy.com",
  ],
  /** Package registries and code hosts. */
  code: [
    "github.com",
    "githubusercontent.com",
    "gitlab.com",
    "bitbucket.org",
    "codeberg.org",
    "sourceforge.net",
    "sr.ht",
    "gitee.com",
    "npmjs.com",
    "npmjs.org",
    "pypi.org",
    "crates.io",
    "rubygems.org",
    "packagist.org",
    "nuget.org",
    "pkg.go.dev",
    "hub.docker.com",
    "jsr.io",
    "hex.pm",
    "cocoapods.org",
    "pub.dev",
    "libraries.io",
    "huggingface.co",
  ],
  /** Review, listing, launch and company directory sites. */
  reviews: [
    "g2.com",
    "capterra.com",
    "trustpilot.com",
    "alternativeto.net",
    "appsumo.com",
    "getapp.com",
    "softwareadvice.com",
    "softwaresuggest.com",
    "trustradius.com",
    "saasworthy.com",
    "saashub.com",
    "slant.co",
    "stackshare.io",
    "betalist.com",
    "crozdesk.com",
    "gartner.com",
    "peerspot.com",
    "sitejabber.com",
    "yelp.com",
    "tripadvisor.com",
    "glassdoor.com",
    "crunchbase.com",
    "wellfound.com",
    "angel.co",
    "f6s.com",
    "uneed.best",
    "microlaunch.net",
    "theresanaiforthat.com",
    "futurepedia.io",
    "toolify.ai",
  ],
  /** Publishing, forum, link-page and profile sites. */
  publishing: [
    "medium.com",
    "substack.com",
    "ghost.io",
    "wordpress.com",
    "blogger.com",
    "blogspot.com",
    "tumblr.com",
    "dev.to",
    "hashnode.com",
    "hackernoon.com",
    "quora.com",
    "stackoverflow.com",
    "stackexchange.com",
    "superuser.com",
    "serverfault.com",
    "askubuntu.com",
    "lobste.rs",
    "slashdot.org",
    "tildes.net",
    "lemmy.world",
    "mastodon.social",
    "mastodon.online",
    "mstdn.social",
    "fosstodon.org",
    "hachyderm.io",
    "infosec.exchange",
    "linktr.ee",
    "beacons.ai",
    "bio.link",
    "about.me",
    "calendly.com",
    "patreon.com",
    "ko-fi.com",
    "buymeacoffee.com",
    "behance.net",
    "dribbble.com",
    "deviantart.com",
    "pinterest.com",
    "vk.com",
    "weibo.com",
    "t.me",
    "telegram.org",
    "wa.me",
    "snapchat.com",
    "twitch.tv",
    "kick.com",
    "vimeo.com",
    "soundcloud.com",
    "open.spotify.com",
    "podcasts.apple.com",
    "goodreads.com",
    "wikipedia.org",
    "wikimedia.org",
    "fandom.com",
    "slideshare.net",
    "scribd.com",
    "academia.edu",
    "researchgate.net",
    "orcid.org",
  ],
} as const satisfies Record<string, readonly string[]>;

const ALL: readonly string[] = Object.values(THIRD_PARTY_HOSTS).flat();

/**
 * Brands that run the same site under many country domains (`capterra.co.uk`, `amazon.de`). Any
 * host with one of these as a whole label is theirs.
 */
export const THIRD_PARTY_BRAND_LABELS: readonly string[] = [
  "capterra",
  "getapp",
  "softwareadvice",
  "trustpilot",
  "amazon",
  "etsy",
];

/** True for a third-party host, any subdomain of one, or any host carrying a brand label. */
export function isThirdPartyHost(host: string): boolean {
  const h = normalizeHost(host);
  if (ALL.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  return h.split(".").some((label) => THIRD_PARTY_BRAND_LABELS.includes(label));
}

/** Path segments that put a person's page under them: `/user/<name>`, `/in/<name>` and the rest. */
const PROFILE_SEGMENTS = new Set([
  "u",
  "user",
  "users",
  "profile",
  "profiles",
  "in",
  "people",
  "members",
  "author",
]);

/**
 * True for a profile path on any host: a segment that starts with `@` or `~` (`/@name`, `/~name`),
 * or a profile segment followed by another segment (`/u/name`, `/en/user/name`). Whole segments
 * only, so `/users` and `/user-guide/start` are fine. The path is decoded before it is split, so
 * `/u%2Fname` is `/u/name`.
 */
export function isProfilePath(pathname: string): boolean {
  const segments = decodeFully(pathname).toLowerCase().split("/");
  return segments.some((segment, i) => {
    if (/^[@~]./.test(segment)) return true;
    const next = segments[i + 1];
    return PROFILE_SEGMENTS.has(segment) && next !== undefined && next !== "";
  });
}

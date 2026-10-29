import {
  decodeForChecks,
  decodedPathAndQuery,
  domainMention,
  matchesDomain,
} from "./platform-hosts";

/**
 * Third-party hosts (docs/PLAN.md 4.3, 12.3): sites that are never someone's own product site, so
 * `fetchOwnSite()` refuses them, every subdomain included. Each is someone else's site, full of
 * reviewers', contributors' and posters' names. Platforms are a separate list
 * (`platform-hosts.ts`, 2.1.10).
 *
 * Pages that people host on their own subdomain of a builder (`*.github.io`, Carrd, Framer, Notion
 * sites and the like) are product sites and stay allowed.
 */

const STORES = [
  "apps.apple.com",
  "itunes.apple.com",
  "play.google.com",
  "chromewebstore.google.com",
  "chrome.google.com",
  "addons.mozilla.org",
  "microsoftedge.microsoft.com",
  "apps.microsoft.com",
  "apps.shopify.com",
  "wordpress.org",
  "marketplace.visualstudio.com",
  "marketplace.atlassian.com",
  "store.steampowered.com",
  "steamcommunity.com",
  "apkpure.com",
  "amazon.com",
  "etsy.com",
  "ebay.com",
] as const;

const CODE_AND_REGISTRIES = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "sourceforge.net",
  "npmjs.com",
  "pypi.org",
  "crates.io",
  "rubygems.org",
  "packagist.org",
  "hub.docker.com",
  "huggingface.co",
  "githubusercontent.com",
] as const;

const REVIEWS_AND_LISTINGS = [
  "g2.com",
  "capterra.com",
  "getapp.com",
  "softwareadvice.com",
  "trustradius.com",
  "trustpilot.com",
  "sitejabber.com",
  "alternativeto.net",
  "saashub.com",
  "appsumo.com",
  "betalist.com",
  "crunchbase.com",
  "glassdoor.com",
  "wellfound.com",
  "angel.co",
  "peerlist.io",
  "yelp.com",
  "tripadvisor.com",
  "maps.google.com",
  "g.page",
] as const;

const PUBLISHING_AND_PROFILES = [
  "medium.com",
  "substack.com",
  "quora.com",
  "pinterest.com",
  "tumblr.com",
  "t.me",
  "telegram.me",
  "twitch.tv",
  "dev.to",
  "stackoverflow.com",
  "stackexchange.com",
  "wikipedia.org",
  "linktr.ee",
  "about.me",
  "beacons.ai",
  "bio.link",
  "mastodon.social",
  "mastodon.online",
  "mstdn.social",
  "lemmy.world",
  "lobste.rs",
  "hashnode.com",
  "gravatar.com",
  "patreon.com",
  "ko-fi.com",
  "buymeacoffee.com",
  "dribbble.com",
  "behance.net",
] as const;

export const THIRD_PARTY_DOMAINS: readonly string[] = [
  ...STORES,
  ...CODE_AND_REGISTRIES,
  ...REVIEWS_AND_LISTINGS,
  ...PUBLISHING_AND_PROFILES,
];

/** True for a third-party domain or any subdomain of one. */
export const isThirdPartyHost = (host: string): boolean => matchesDomain(host, THIRD_PARTY_DOMAINS);

const THIRD_PARTY_MENTION = domainMention(THIRD_PARTY_DOMAINS);

/** True when a URL's path or query names a third-party domain (`/go/github.com/ana`). */
export const mentionsThirdPartyHost = (url: URL): boolean =>
  THIRD_PARTY_MENTION.test(decodedPathAndQuery(url));

/**
 * A person's profile: `@name` or `~name` in any segment, a `u` segment anywhere, a profile word as
 * the first segment after an optional locale (`/en/`, `/pt-br/`), or `/in/<name>` alone (LinkedIn
 * style; `/in/` followed by more is a locale, as in `/in/pricing/plans`).
 */
const PROFILE_PATH = [
  /(^|\/)[@~][^/]/,
  /(^|\/)u\/[^/]/i,
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:user|users|profile|profiles|people|member|members)(?:\/|$)/i,
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?in\/[^/]+\/?$/i,
];

/**
 * True when a path on any host is a person's profile. The path is decoded and runs of slashes are
 * folded first, because servers commonly serve `//@ana` as `/@ana`.
 */
export function isProfilePath(pathname: string): boolean {
  const path = decodeForChecks(pathname)
    .split("?")[0]!
    .replace(/\/{2,}/g, "/");
  return PROFILE_PATH.some((re) => re.test(path));
}

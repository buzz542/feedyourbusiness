import type { LinkSource, SearchLink } from "./types";

/**
 * Link-mode sources. AskedFor never fetches these. It builds a search URL and the user opens it
 * in their own browser. No API, no RSS, no scraping, no scraping services.
 *
 * Reddit stops accepting new public API access on 31 Oct 2026 and commercial use needs a
 * contract, so Reddit stays link-only. See docs/BRIEF.md, "Data sources".
 */

function makeLinkSource(args: {
  id: string;
  displayName: string;
  termsUrl: string;
  host: string;
  build: (term: string) => string;
}): LinkSource {
  return {
    id: args.id,
    displayName: args.displayName,
    mode: "link",
    termsUrl: args.termsUrl,
    allowedHosts: [],
    dailyBudget: 0,
    linkHosts: [args.host],
    searchLinks(terms): SearchLink[] {
      return terms
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((term) => ({ term, url: args.build(encodeURIComponent(term)) }));
    },
  };
}

export const reddit = makeLinkSource({
  id: "reddit",
  displayName: "Reddit",
  termsUrl: "https://www.redditinc.com/policies/data-api-terms",
  host: "www.reddit.com",
  build: (q) => `https://www.reddit.com/search/?q=${q}&sort=new`,
});

export const linkedin = makeLinkSource({
  id: "linkedin",
  displayName: "LinkedIn",
  termsUrl: "https://www.linkedin.com/legal/user-agreement",
  host: "www.linkedin.com",
  build: (q) =>
    `https://www.linkedin.com/search/results/content/?keywords=${q}&sortBy=%22date_posted%22`,
});

export const facebook = makeLinkSource({
  id: "facebook",
  displayName: "Facebook",
  termsUrl: "https://www.facebook.com/terms",
  host: "www.facebook.com",
  build: (q) => `https://www.facebook.com/search/posts/?q=${q}`,
});

export const threads = makeLinkSource({
  id: "threads",
  displayName: "Threads",
  termsUrl: "https://help.instagram.com/769983657850450",
  host: "www.threads.com",
  build: (q) => `https://www.threads.com/search?q=${q}&filter=recent`,
});

export const indiehackers = makeLinkSource({
  id: "indiehackers",
  displayName: "Indie Hackers",
  termsUrl: "https://www.indiehackers.com/terms",
  host: "www.indiehackers.com",
  build: (q) => `https://www.indiehackers.com/search?q=${q}`,
});

/** X as a search link only. Collection through the official API is phase 2 and off by default. */
export const xLinks = makeLinkSource({
  id: "x_links",
  displayName: "X",
  termsUrl: "https://x.com/en/tos",
  host: "x.com",
  build: (q) => `https://x.com/search?q=${q}&f=live&src=typed_query`,
});

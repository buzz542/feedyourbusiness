import { isProfileCommunity, isSensitiveCommunity } from "./sensitive-communities";

/**
 * Per-subreddit search links from `products.subreddits` (docs/PLAN.md 7.8). Never fetched: the
 * user opens them in their own browser. Profiles and sensitive communities never get a link.
 */
export const SUBREDDIT_LINK_HOST = "www.reddit.com";

const NAME = /^[A-Za-z0-9_]{2,21}$/;

export interface SubredditLink {
  subreddit: string;
  term: string;
  url: string;
}

export function subredditSearchLinks(
  subreddits: readonly string[],
  terms: readonly string[],
): SubredditLink[] {
  const subs = subreddits.filter(
    (s) => NAME.test(s) && !isProfileCommunity(s) && !isSensitiveCommunity(s),
  );
  const clean = terms.map((t) => t.trim()).filter(Boolean);
  return subs.flatMap((subreddit) =>
    clean.map((term) => ({
      subreddit,
      term,
      url: `https://www.reddit.com/r/${subreddit}/search/?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new`,
    })),
  );
}

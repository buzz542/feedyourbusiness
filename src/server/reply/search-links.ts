import { isProfileCommunity, isSensitiveCommunity } from "@/sources/sensitive-communities";
import type { LinkSource } from "@/sources/types";

/**
 * The search links panel (docs/PLAN.md 4.4, 7.8): for each term, one-tap searches the user opens
 * in their own browser, plus per-subreddit searches from the product's suggested subreddits.
 * Nothing here is fetched by AskedFor.
 */

export interface LinkGroup {
  /** The platform name, in text only (no logos). */
  label: string;
  links: { label: string; url: string }[];
}

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;
const MAX_TERMS = 40;

export function buildSearchLinks(input: {
  sources: readonly LinkSource[];
  terms: readonly string[];
  subreddits: readonly string[];
}): LinkGroup[] {
  const terms = [...new Set(input.terms.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TERMS);
  const groups: LinkGroup[] = input.sources.map((source) => ({
    label: source.displayName,
    links: source.searchLinks(terms).map((l) => ({ label: l.term, url: l.url })),
  }));
  const redditOn = input.sources.some((s) => s.id === "reddit_links");
  const subs = input.subreddits.filter(
    (s) => SUBREDDIT.test(s) && !isSensitiveCommunity(s) && !isProfileCommunity(s),
  );
  if (redditOn && subs.length > 0 && terms.length > 0) {
    for (const sub of subs) {
      groups.push({
        label: `Reddit · r/${sub}`,
        links: terms.map((term) => ({
          label: term,
          url: `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new`,
        })),
      });
    }
  }
  return groups.filter((g) => g.links.length > 0);
}

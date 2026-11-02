import { DISCLOSURE } from "@/server/reply/tips";
import { subredditSearchLinks } from "@/sources/subreddit-links";
import type { LinkSource } from "@/sources/types";

const MAX_TERMS = 8;

/**
 * One-tap searches on the platforms AskedFor never collects, plus the product's subreddits
 * (docs/PLAN.md 4.4, 7.8). The user opens each in their own browser; nothing is fetched.
 */
export function SearchLinksPanel({
  terms,
  subreddits,
  sources,
}: {
  terms: readonly string[];
  subreddits: readonly string[];
  sources: readonly LinkSource[];
}) {
  const shown = terms.slice(0, MAX_TERMS);
  if (shown.length === 0) return null;
  const subLinks = subredditSearchLinks(subreddits, shown);
  return (
    <section aria-labelledby="search-links" className="flex flex-col gap-3">
      <h2 id="search-links" className="font-serif text-lg">
        Search it yourself
      </h2>
      <p className="text-sm">{DISCLOSURE}</p>
      <ul className="flex flex-col gap-2 text-sm">
        {shown.map((term) => (
          <li key={term} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium">{term}</span>
            {sources.flatMap((source) =>
              source.searchLinks([term]).map((link) => (
                <a
                  key={`${source.id}:${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-2"
                >
                  {source.displayName}
                </a>
              )),
            )}
            {subLinks
              .filter((l) => l.term === term)
              .map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-2"
                >
                  r/{l.subreddit}
                </a>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { DISCLOSURE } from "@/server/reply/tips";
import { subredditSearchLinks } from "@/sources/subreddit-links";
import type { LinkSource } from "@/sources/types";

const MAX_TERMS = 8;

const LINK =
  "inline-flex min-h-8 items-center rounded-[3px] border border-control bg-surface px-2 text-xs text-accent underline-offset-2 hover:border-ink hover:underline";

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
  // Subreddit searches are Reddit search links: they follow the reddit_links kill switch.
  const subLinks = sources.some((s) => s.id === "reddit_links")
    ? subredditSearchLinks(subreddits, shown)
    : [];
  return (
    <section
      aria-labelledby="search-links"
      className="mt-4 flex flex-col gap-4 rounded-[2px] border border-rule bg-panel p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="search-links" className="font-serif text-lg tracking-tight">
          Search it yourself
        </h2>
        <p className="text-sm text-muted">
          Searches for your terms that you open yourself, each in a new tab.{" "}
          <span className="font-medium text-ink">{DISCLOSURE}</span>
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-rule text-sm">
        {shown.map((term) => (
          <li key={term} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <span className="font-medium">{term}</span>
            <span className="flex flex-wrap gap-1.5">
              {sources.flatMap((source) =>
                source.searchLinks([term]).map((link) => (
                  <a
                    key={`${source.id}:${link.url}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK}
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
                    className={LINK}
                  >
                    r/{l.subreddit}
                  </a>
                ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

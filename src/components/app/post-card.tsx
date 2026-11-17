import { buttonClass } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Highlight } from "@/components/ui/highlight";
import { ChevronIcon, ExternalIcon, TipIcon } from "@/components/ui/icons";
import { CATEGORY_LABELS, DISCLOSURE, REPLY_TIPS, SOURCE_LABELS } from "@/server/reply/tips";
import type { FeedItem } from "@/server/store/feed";
import { PostActions, type SetPostState } from "./post-actions";

/** "Reddit · r/SaaS", "Hacker News", "Bluesky" (docs/PLAN.md 4.4). */
export function sourceLine(source: string, community: string | null): string {
  const label = SOURCE_LABELS[source] ?? source;
  return community && community !== label ? `${label} · ${community}` : label;
}

/** "15m", "3h", "2d": the post's age. */
export function age(postedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(postedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Stored highlight offsets count code points (as Postgres counts the excerpt); <Highlight> slices
 * UTF-16 units. Converts, or returns null for a range that does not fit.
 */
export function unitRange(
  text: string,
  start: number | null,
  end: number | null,
): { start: number; end: number } | null {
  if (start === null || end === null) return null;
  const points = Array.from(text);
  if (start < 0 || end <= start || end > points.length) return null;
  const from = points.slice(0, start).join("").length;
  return { start: from, end: from + points.slice(start, end).join("").length };
}

const Dot = () => (
  <span aria-hidden="true" className="px-1.5">
    ·
  </span>
);

/**
 * One Reply card (docs/PLAN.md 4.4). Top to bottom: source, community and posted time on one line
 * with the match score; the excerpt as stored (280 characters at most) with the highlighter; one
 * line on why it matched, with the category and any rival; "Say you built it." with the reply tip
 * beside it, right above Open post; then one row of actions: Open post, Save, Hide, I replied.
 *
 * It renders the fields named here and nothing else. No author is ever shown (D5): no name,
 * handle, hash or avatar, and the post's address is only ever the link, never words on the card.
 */
export function PostCard({
  item,
  now,
  rivalName,
  setState,
}: {
  item: FeedItem;
  now: Date;
  rivalName?: string | null;
  setState: SetPostState;
}) {
  const range = unitRange(item.excerpt, item.highlightStart, item.highlightEnd);
  const rival = rivalName ?? item.toolMentioned;
  const source = SOURCE_LABELS[item.source] ?? item.source;
  const community = item.community && item.community !== source ? item.community : null;
  return (
    <article className="flex flex-col gap-3 rounded-[2px] border border-rule bg-surface p-4 has-[[data-state=hidden]]:border-dashed has-[[data-state=hidden]]:border-control sm:p-5">
      <header data-card-meta="" className="flex items-baseline gap-3 text-sm text-muted">
        <p className="min-w-0 truncate">
          <span className="font-medium text-ink">{source}</span>
          {community ? (
            <>
              <Dot />
              {community}
            </>
          ) : null}
          <Dot />
          <span className="sr-only">Posted </span>
          <time dateTime={item.postedAt}>{age(item.postedAt, now)} ago</time>
        </p>
        <p className="ml-auto shrink-0 tabular-nums">{item.relevance}% match</p>
      </header>
      <p
        data-card-excerpt=""
        className="text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]"
      >
        <Highlight text={item.excerpt} start={range?.start} end={range?.end} />
      </p>
      <p data-card-why="" className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <Chip>{CATEGORY_LABELS[item.category]}</Chip>
        {rival ? (
          <Chip tone="accent">
            <span className="sr-only">Mentions </span>
            {rival}
          </Chip>
        ) : null}
        <span className="text-muted">
          <span className="font-medium text-ink">Why it matched:</span> {item.reason}
        </span>
      </p>
      <details className="group border-t border-rule pt-3 text-sm">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
          <span className="font-medium text-ink">{DISCLOSURE}</span>
          <span className="inline-flex items-center gap-1.5 text-muted group-hover:text-ink">
            <ChevronIcon size={14} className="transition-transform group-open:rotate-90" />
            <TipIcon size={14} />
            Reply tip
          </span>
        </summary>
        <p className="mt-2 max-w-prose text-ink">{REPLY_TIPS[item.category]}</p>
      </details>
      <footer data-card-actions="">
        <PostActions
          id={item.id}
          state={item.state}
          setState={setState}
          counted={{ createdAt: item.createdAt, relevance: item.relevance }}
          open={
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              data-action="open"
              className={buttonClass("primary", "px-2.5 sm:px-3")}
            >
              Open post
              <ExternalIcon size={14} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          }
        />
      </footer>
    </article>
  );
}

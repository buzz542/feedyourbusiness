import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Highlight } from "@/components/ui/highlight";
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

/**
 * One Reply card (docs/PLAN.md 4.4): source and community, age, category, match, the excerpt with
 * the highlighter, why it matched, the rival chip, Open post, the reply tip and the disclosure
 * line, then the actions. No author is ever shown (D5): the card links to the post instead.
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
  return (
    <Card as="article" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>{sourceLine(item.source, item.community)}</span>
        <span aria-label="Posted">{age(item.postedAt, now)}</span>
        <Chip>{CATEGORY_LABELS[item.category]}</Chip>
        {rival ? <Chip tone="accent">{rival}</Chip> : null}
        <span className="ml-auto tabular-nums" aria-label="Match">
          {item.relevance}% match
        </span>
      </div>
      <p className="leading-relaxed">
        <Highlight text={item.excerpt} start={range?.start} end={range?.end} />
      </p>
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">Why it matched: </span>
        {item.reason}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          data-action="open"
          className="font-medium text-accent underline underline-offset-2"
        >
          Open post
        </a>
        <span>{DISCLOSURE}</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Reply tip</summary>
        <p className="mt-1">{REPLY_TIPS[item.category]}</p>
      </details>
      <PostActions id={item.id} state={item.state} setState={setState} />
    </Card>
  );
}

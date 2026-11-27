import { Chip } from "@/components/ui/chip";
import { Highlight } from "@/components/ui/highlight";
import { CATEGORY_LABELS, DISCLOSURE, REPLY_TIPS, SOURCE_LABELS } from "@/server/reply/tips";
import type { FeedItem } from "@/server/store/feed";
import { age, sourceLine, unitRange } from "./post-card-parts";

/** "Nov 2, 2026": the day it was posted, in UTC so the server and the browser agree. */
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * The conversation detail (the founder's brief, 27 Nov 2026): everything we hold about one post, in
 * the side panel on wide screens and full screen on phones. The stored excerpt is all we keep (280
 * characters at most, 2.3.1), so it says so and points to the original. No author, ever (D5).
 */
export function ConversationDetail({
  item,
  now,
  rivalName,
}: {
  item: FeedItem;
  now: Date;
  rivalName: string | null;
}) {
  const range = unitRange(item.excerpt, item.highlightStart, item.highlightEnd);
  const rival = rivalName ?? item.toolMentioned;
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-col gap-1 text-muted">
        <p className="font-medium text-ink">{sourceLine(item.source, item.community)}</p>
        <p>
          Posted <time dateTime={item.postedAt}>{day(item.postedAt)}</time>,{" "}
          {age(item.postedAt, now)} ago
        </p>
        <p className="tabular-nums">{item.relevance}% match</p>
      </div>
      <section aria-label={`What the post says, on ${SOURCE_LABELS[item.source] ?? item.source}`}>
        <p
          data-detail-excerpt=""
          className="border-l-2 border-control pl-4 text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]"
        >
          <Highlight text={item.excerpt} start={range?.start} end={range?.end} />
        </p>
        <p className="mt-2 text-muted">
          We keep up to 280 characters of each post. Open the original conversation for the full
          thread.
        </p>
      </section>
      <div data-detail-why="" className="rounded-xl bg-selected p-3.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-ink">Why it matched</span>
          <Chip>{CATEGORY_LABELS[item.category]}</Chip>
          {rival ? (
            <Chip tone="accent">
              <span className="sr-only">Mentions </span>
              {rival}
            </Chip>
          ) : null}
        </p>
        <p className="mt-1 text-muted">{item.reason}</p>
      </div>
      <div className="border-t border-rule pt-3">
        <p className="font-medium text-ink">{DISCLOSURE}</p>
        <p className="mt-1 max-w-prose text-ink">{REPLY_TIPS[item.category]}</p>
      </div>
    </div>
  );
}

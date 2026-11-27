import { buttonClass } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Highlight } from "@/components/ui/highlight";
import { ChevronIcon, ExternalIcon, TipIcon } from "@/components/ui/icons";
import { CATEGORY_LABELS, DISCLOSURE, REPLY_TIPS, SOURCE_LABELS } from "@/server/reply/tips";
import type { FeedItem } from "@/server/store/feed";
import { ConversationDetail } from "./conversation-detail";
import { PostActions, type MarkOpened, type SetPostState } from "./post-actions";
import { age, sourceLine, unitRange } from "./post-card-parts";

export { age, sourceLine, unitRange };

const Dot = () => (
  <span aria-hidden="true" className="px-1.5">
    ·
  </span>
);

/**
 * One Reply card (docs/PLAN.md 4.4). Top to bottom: source, community and posted time on one line
 * with the match score; the excerpt as stored (280 characters at most) with the highlighter; one
 * block on why it matched, set apart, with the category and any rival; "Say you built it." with the
 * reply tip beside it, right above View conversation; then one row of actions: View conversation,
 * Save, Hide, I replied, and Details, which opens the conversation detail (conversation-detail.tsx).
 *
 * It renders the fields named here and nothing else. No author is ever shown (D5): no name,
 * handle, hash or avatar, and the post's address is only ever the link, never words on the card.
 */
export function PostCard({
  item,
  now,
  rivalName,
  setState,
  markOpened,
}: {
  item: FeedItem;
  now: Date;
  rivalName?: string | null;
  setState: SetPostState;
  markOpened?: MarkOpened;
}) {
  const range = unitRange(item.excerpt, item.highlightStart, item.highlightEnd);
  const rival = rivalName ?? item.toolMentioned;
  const source = SOURCE_LABELS[item.source] ?? item.source;
  const community = item.community && item.community !== source ? item.community : null;
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 has-[[data-state=hidden]]:border-dashed has-[[data-state=hidden]]:border-control sm:p-6">
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
        className="border-l-2 border-control pl-4 text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]"
      >
        <Highlight text={item.excerpt} start={range?.start} end={range?.end} />
      </p>
      {/* Our explanation, set apart from the post's own words above it (the founder's brief). */}
      <div data-card-why="" className="rounded-xl bg-selected p-3.5 text-sm">
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
          markOpened={markOpened}
          detail={<ConversationDetail item={item} now={now} rivalName={rivalName ?? null} />}
          open={
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              data-action="open"
              className={buttonClass("primary", "px-3 sm:px-4")}
            >
              View conversation
              <ExternalIcon size={14} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          }
        />
      </footer>
    </article>
  );
}

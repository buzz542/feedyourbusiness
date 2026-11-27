import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { FeedView } from "@/lib/feed-views";
import type { SourceProgress } from "@/server/pipeline/first-run";
import {
  activeFilterCount,
  clearFiltersHref,
  feedHref,
  type FeedFilter,
  type FeedPage,
  type FeedSource,
} from "@/server/store/feed";
import type { LinkSource } from "@/sources/types";
import { FeedKeyboard } from "./feed-keyboard";
import { FilterBar } from "./filter-bar";
import { FirstRunProgress } from "./first-run-progress";
import { PostCard } from "./post-card";
import type { SetPostState } from "./post-actions";
import { SearchLinksPanel } from "./search-links-panel";
import { VIEW_LABELS } from "./view-labels";

/** What each view holds, under its heading. */
const VIEW_INTROS: Record<FeedView, string> = {
  today: "Conversations worth a closer look, from the last 24 hours.",
  all: "Every conversation we still hold for you, except the ones you hid.",
  saved: "Conversations you saved to come back to.",
  replied: "Conversations you marked as replied.",
  hidden: "Conversations you hid. Press Hide again on one to bring it back.",
};

/** What to do next when a view is empty (docs/PLAN.md 4.9; the founder's brief, 27 Nov 2026). */
const EMPTY: Record<FeedView, { title: string; body: string }> = {
  today: {
    title: "No conversations to show yet.",
    body: "New conversations arrive each morning. Look through All conversations, or run the searches below.",
  },
  all: {
    title: "No conversations to show yet.",
    body: "They show up here once we collect matches for your product. Try a lower minimum match, or run the searches below.",
  },
  saved: {
    title: "Your saved conversations will appear here.",
    body: "Press Save on a conversation, or s, to keep it here for later.",
  },
  replied: {
    title: "Conversations you mark as replied will appear here.",
    body: "After you reply, press I replied, or r, and it moves here.",
  },
  hidden: {
    title: "Conversations you hide will appear here.",
    body: "They wait here until they are deleted, in case you want one back.",
  },
};

/**
 * The Reply tab's main column (docs/PLAN.md 4.4): the view's heading, filters across the top with
 * their count, the cards, Load more and the search links. The views themselves are in the frame's
 * side panel or tab bar (app-frame.tsx). The page loads the data; this only renders it.
 */
export function ReplyView({
  filter,
  defaultMin,
  feed,
  now,
  rivals,
  sources,
  terms,
  subreddits,
  links,
  firstRun,
  setState,
}: {
  filter: FeedFilter;
  defaultMin: number;
  feed: FeedPage;
  now: Date;
  rivals: readonly { id: string; name: string }[];
  /** Collect sources switched on now, for the source filter. */
  sources: readonly FeedSource[];
  terms: readonly string[];
  subreddits: readonly string[];
  links: readonly LinkSource[];
  /** The first run's progress while it runs, otherwise null. */
  firstRun: readonly SourceProgress[] | null;
  setState: SetPostState;
}) {
  const rivalNames = new Map(rivals.map((c) => [c.id, c.name]));
  const filtered = activeFilterCount(filter, defaultMin) > 0;
  const empty = EMPTY[filter.view];

  return (
    <div className="flex flex-col gap-6">
      <FeedKeyboard />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">{VIEW_LABELS[filter.view]}</h1>
        <p className="text-sm text-muted">{VIEW_INTROS[filter.view]}</p>
      </header>
      {firstRun ? <FirstRunProgress progress={firstRun} /> : null}
      <FilterBar filter={filter} defaultMin={defaultMin} rivals={rivals} sources={sources} />
      {feed.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No conversations match these filters."
            action={
              <Link href={clearFiltersHref(filter)} className={buttonClass("secondary")}>
                Clear filters
              </Link>
            }
          >
            Try fewer filters, or a lower minimum match.
          </EmptyState>
        ) : (
          <EmptyState title={empty.title}>{empty.body}</EmptyState>
        )
      ) : (
        <>
          <p className="-mb-2 text-sm text-muted">
            <span className="font-medium text-ink tabular-nums">{feed.total}</span>{" "}
            {feed.total === 1 ? "conversation" : "conversations"}
            {filtered ? (feed.total === 1 ? " matches these filters" : " match these filters") : ""}
            , newest first.
          </p>
          <ol className="flex flex-col gap-4">
            {feed.items.map((item) => (
              <li
                key={item.id}
                id={`post-${item.id}`}
                data-feed-card
                tabIndex={-1}
                className="rounded-2xl [contain-intrinsic-size:auto_16rem] [content-visibility:auto] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
              >
                <PostCard
                  item={item}
                  now={now}
                  rivalName={item.competitorId ? rivalNames.get(item.competitorId) : null}
                  setState={setState}
                />
              </li>
            ))}
          </ol>
        </>
      )}
      {feed.hasMore ? (
        <div className="flex flex-col items-center gap-2 text-sm text-muted">
          <p>
            Showing <span className="tabular-nums">{feed.items.length}</span> of{" "}
            <span className="tabular-nums">{feed.total}</span>
          </p>
          <Link
            href={feedHref(filter, { page: filter.page + 1 })}
            className={buttonClass("secondary")}
            scroll={false}
          >
            Load more
          </Link>
        </div>
      ) : null}
      <SearchLinksPanel terms={terms} subreddits={subreddits} sources={links} />
    </div>
  );
}

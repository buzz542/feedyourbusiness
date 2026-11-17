import type { Metadata } from "next";
import Link from "next/link";
import { FeedKeyboard } from "@/components/app/feed-keyboard";
import { FilterBar } from "@/components/app/filter-bar";
import { FirstRunProgress } from "@/components/app/first-run-progress";
import { PostCard } from "@/components/app/post-card";
import { SearchLinksPanel } from "@/components/app/search-links-panel";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VIEW_LABELS, type FeedView } from "@/lib/feed-views";
import { requireEntitledUser } from "@/server/auth/entitled";
import { firstRunActive } from "@/server/pipeline/first-run";
import { loadFirstRunProgress } from "@/server/pipeline/first-run-server";
import {
  activeFilterCount,
  clearFiltersHref,
  feedHref,
  isFeedSource,
  parseFeedParams,
} from "@/server/store/feed";
import { loadFeed, loadReplyProduct } from "@/server/store/feed-supabase";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { collectSources, linkSources } from "@/sources/registry";
import { setPostState } from "./actions";

export const metadata: Metadata = { title: "Reply" };
export const dynamic = "force-dynamic";

/** What each view holds, under its heading. */
const VIEW_INTROS: Record<FeedView, string> = {
  today: "Posts from the last 24 hours that you have not replied to or hidden.",
  all: "Every post we still hold for you, except the ones you hid.",
  saved: "Posts you saved to come back to.",
  replied: "Posts you marked as replied.",
  hidden: "Posts you hid. Press Hide again on one to bring it back.",
};

/** What to do next when a view is empty (docs/PLAN.md 4.9). */
const EMPTY: Record<FeedView, { title: string; body: string }> = {
  today: {
    title: "Nothing new today",
    body: "New posts arrive each morning. Look through All, or run the searches below.",
  },
  all: {
    title: "No posts yet",
    body: "Posts show up here once we collect matches for your product. Try a lower minimum match, or run the searches below.",
  },
  saved: {
    title: "Nothing saved",
    body: "Press Save on a post, or s, to keep it here for later.",
  },
  replied: {
    title: "No replies marked yet",
    body: "After you reply to a post, press I replied, or r, and it moves here.",
  },
  hidden: {
    title: "Nothing hidden",
    body: "Posts you hide wait here, in case you want one back.",
  },
};

/**
 * The Reply tab (docs/PLAN.md 4.4): the view's heading, filters across the top with their count,
 * the cards, Load more and the search links. The views themselves are in the frame's side panel
 * or tab bar (src/components/app/app-frame.tsx).
 */
export default async function ReplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Back from Checkout, the welcome step confirms the session and applies the billing patch before
  // the entitlement check, then starts the first run (7.3). Layouts do not re-run on client
  // navigation, so each page checks for itself (10.4).
  const search = await searchParams;
  const sessionId = Array.isArray(search.session_id) ? search.session_id[0] : search.session_id;
  const user = await requireEntitledUser(
    "/app/reply",
    search.welcome === "1" ? { sessionId } : undefined,
  );
  if (user === "confirming")
    return (
      <EmptyState title="Confirming your payment">
        Stripe has not told us about your payment yet. This usually takes a few seconds. Refresh
        this page in a minute.
      </EmptyState>
    );
  const supabase = await createSupabaseServerClient();
  const product = await loadReplyProduct(supabase, user.id);
  if (!product)
    return (
      <EmptyState
        title="No product yet"
        action={
          <Link href="/app/onboarding" className={buttonClass("primary")}>
            Set up your product
          </Link>
        }
      >
        Paste your website and we will find the posts worth replying to.
      </EmptyState>
    );

  const filter = parseFeedParams(search);
  const progress = await loadFirstRunProgress(product.id);
  const now = new Date();
  const feed = await loadFeed(supabase, product.id, filter, now, product.threshold);
  const rivals = new Map(product.competitors.map((c) => [c.id, c.name]));
  const filtered = activeFilterCount(filter, product.threshold) > 0;
  const empty = EMPTY[filter.view];

  return (
    <div className="flex flex-col gap-6">
      <FeedKeyboard />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">{VIEW_LABELS[filter.view]}</h1>
        <p className="text-sm text-muted">{VIEW_INTROS[filter.view]}</p>
      </header>
      {firstRunActive(progress) ? <FirstRunProgress progress={progress} /> : null}
      <FilterBar
        filter={filter}
        defaultMin={product.threshold}
        rivals={product.competitors}
        sources={collectSources()
          .map((s) => s.id)
          .filter(isFeedSource)}
      />
      {feed.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No posts match these filters"
            action={
              <Link href={clearFiltersHref(filter)} className={buttonClass("secondary")}>
                Clear all filters
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
            {feed.total === 1 ? "post" : "posts"}
            {filtered ? " match these filters" : ""}, best match first.
          </p>
          <ol className="flex flex-col gap-4">
            {feed.items.map((item) => (
              <li
                key={item.id}
                id={`post-${item.id}`}
                data-feed-card
                tabIndex={-1}
                className="rounded-[2px] [contain-intrinsic-size:auto_16rem] [content-visibility:auto] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
              >
                <PostCard
                  item={item}
                  now={now}
                  rivalName={item.competitorId ? rivals.get(item.competitorId) : null}
                  setState={setPostState}
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
      <SearchLinksPanel
        terms={product.terms}
        subreddits={product.subreddits}
        sources={linkSources()}
      />
    </div>
  );
}

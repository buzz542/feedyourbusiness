import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { FeedKeys } from "@/components/app/reply/feed-keys";
import { FilterBar } from "@/components/app/reply/filter-bar";
import { FirstRunBanner } from "@/components/app/reply/first-run-banner";
import { PostCard } from "@/components/app/reply/post-card";
import { SearchLinksPanel } from "@/components/app/reply/search-links-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { cx } from "@/components/ui/cx";
import { feedHref, FEED_VIEWS, parseFeedFilters, type FeedView } from "@/lib/reply-filters";
import { DISCLOSURE } from "@/lib/reply-tips";
import { requirePage } from "@/server/auth/app-state";
import { createSupabaseEventSink } from "@/server/events/sink";
import { track } from "@/server/events/track";
import { loadFirstRunStatus } from "@/server/pipeline/supabase-first-run";
import { createFeedLoader } from "@/server/reply/feed";
import { buildSearchLinks } from "@/server/reply/search-links";
import { loadReplyContext } from "@/server/reply/supabase-reply";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { linkSources } from "@/sources/registry";
import { WelcomeStep } from "./welcome-step";
import { setPostStateAction } from "./actions";

export const metadata: Metadata = { title: "Reply" };
// The welcome step processes the first run after the response (up to 240 of 300 seconds).
export const maxDuration = 300;

const VIEW_LABELS: Readonly<Record<FeedView, string>> = {
  today: "Today",
  all: "All",
  saved: "Saved",
  replied: "Replied",
};

const UNDO = /^([0-9a-f-]{36})\.(new|saved|replied|hidden)\.(saved|replied|hidden)$/;
const UNDO_LABELS = { saved: "Saved.", replied: "Marked replied.", hidden: "Hidden." } as const;

type Params = Record<string, string | string[] | undefined>;

/** The Reply tab (docs/PLAN.md 4.4): who to reply to today. */
export default async function ReplyPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  await WelcomeStep({ params });

  const { user, state } = await requirePage("reply", "/app/reply");
  const product = state.product!;
  const db = await createSupabaseServerClient();
  const context = await loadReplyContext(db, product.id);
  const filters = parseFeedFilters(params, context.threshold);
  const now = new Date();
  const feed = await createFeedLoader(db)(product.id, filters, now);
  // The banner is a nicety: any failure (config included) hides it rather than the page.
  const firstRun = await Promise.resolve()
    .then(() => loadFirstRunStatus(createSupabaseAdminClient(), product.id))
    .catch(() => null);
  const groups = buildSearchLinks({
    sources: linkSources(),
    terms: context.terms,
    subreddits: context.subreddits,
  });
  const back = feedHref(filters, {}, context.threshold);
  const undoRaw = typeof params.undo === "string" ? UNDO.exec(params.undo) : null;
  const undo = undoRaw
    ? { id: undoRaw[1]!, from: undoRaw[2]!, to: undoRaw[3] as keyof typeof UNDO_LABELS }
    : null;

  after(() =>
    track(createSupabaseEventSink(), "feed_opened", user.id, { view: filters.view }, new Date()),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-3xl tracking-tight">Reply</h1>
        <FeedKeys />
      </div>

      {firstRun && !firstRun.finished ? <FirstRunBanner status={firstRun} /> : null}

      <nav aria-label="Views">
        <ul className="flex flex-wrap gap-1 border-b border-rule">
          {FEED_VIEWS.map((view) => {
            const active = filters.view === view;
            const count = feed.counts[view];
            return (
              <li key={view}>
                <Link
                  href={feedHref(filters, { view }, context.threshold)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-sm",
                    active
                      ? "border-accent font-medium text-ink"
                      : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {VIEW_LABELS[view]}
                  <span className="tabular-nums text-muted">{count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {undo ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-[2px] border border-rule bg-sunk p-3 text-sm"
        >
          <span>{UNDO_LABELS[undo.to]}</span>
          <form action={setPostStateAction}>
            <input type="hidden" name="id" value={undo.id} />
            <input type="hidden" name="to" value={undo.from} />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="undo" value="1" />
            <button type="submit" className="font-medium underline underline-offset-4">
              Undo
            </button>
          </form>
        </div>
      ) : null}

      <FilterBar filters={filters} rivals={context.rivals} threshold={context.threshold} />

      {feed.cards.length === 0 ? (
        <EmptyState
          title={
            filters.view === "today"
              ? "Nothing new today"
              : `Nothing in ${VIEW_LABELS[filters.view]}`
          }
          body={
            <>
              New posts arrive every morning. To see more, add search terms or lower the minimum
              match in{" "}
              <Link href="/app/settings" className="underline underline-offset-4">
                Settings
              </Link>
              , or open the searches below yourself.
            </>
          }
        />
      ) : (
        <ul className="space-y-3" aria-label="Posts worth replying to">
          {feed.cards.map((card) => (
            <PostCard key={card.id} card={card} now={now} action={setPostStateAction} back={back} />
          ))}
        </ul>
      )}

      {feed.hasMore ? (
        <div className="text-center">
          <Link
            href={feedHref(filters, { page: filters.page + 1 }, context.threshold)}
            scroll={false}
            className="inline-flex min-h-10 items-center rounded-[2px] border border-rule-strong px-4 text-sm hover:bg-sunk"
          >
            Load more
          </Link>
        </div>
      ) : null}

      <p className="text-sm text-muted">
        AskedFor never posts or replies for you. You open each post and write your own reply.{" "}
        <span className="font-medium text-ink">{DISCLOSURE}</span>
      </p>

      <SearchLinksPanel groups={groups} />
    </div>
  );
}

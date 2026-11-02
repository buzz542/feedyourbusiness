import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/app/filter-bar";
import { FirstRunProgress } from "@/components/app/first-run-progress";
import { PostCard } from "@/components/app/post-card";
import { SearchLinksPanel } from "@/components/app/search-links-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { requireAppUser } from "@/server/auth/session";
import { requireEntitledUser } from "@/server/auth/entitled";
import { welcomeFromCheckout } from "@/server/billing/welcome-server";
import { firstRunActive } from "@/server/pipeline/first-run";
import { ensureFirstRun, loadFirstRunProgress } from "@/server/pipeline/first-run-server";
import { FEED_VIEWS, feedHref, parseFeedParams, type FeedView } from "@/server/store/feed";
import { loadFeed, loadReplyProduct } from "@/server/store/feed-supabase";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { linkSources } from "@/sources/registry";
import { setPostState } from "./actions";

export const metadata: Metadata = { title: "Reply" };
export const dynamic = "force-dynamic";

const VIEW_LABELS: Record<FeedView, string> = {
  today: "Today",
  all: "All",
  saved: "Saved",
  replied: "Replied",
};

/** The Reply tab (docs/PLAN.md 4.4): views with counts, filters in the URL, cards, search links. */
export default async function ReplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Back from Checkout: confirm the session and apply the billing patch before the entitlement
  // check (7.3), so a new subscriber never lands on the billing page.
  const search = await searchParams;
  if (search.welcome === "1") {
    const signedIn = await requireAppUser("/app/reply");
    const sessionId = Array.isArray(search.session_id) ? search.session_id[0] : search.session_id;
    await welcomeFromCheckout(signedIn.id, sessionId);
  }
  // Layouts do not re-run on client navigation, so each page checks for itself (10.4).
  const user = await requireEntitledUser("/app/reply");
  const supabase = await createSupabaseServerClient();
  const product = await loadReplyProduct(supabase, user.id);
  if (!product)
    return (
      <EmptyState
        title="No product yet"
        action={
          <Link href="/app/onboarding" className="text-accent underline">
            Set up your product
          </Link>
        }
      >
        Paste your website and we will find the posts worth replying to.
      </EmptyState>
    );

  const filter = parseFeedParams(search);
  // Back from checkout: start the first run once (7.3); entitlement was checked above.
  if (search.welcome === "1") await ensureFirstRun(product.id);
  const progress = await loadFirstRunProgress(product.id);
  const now = new Date();
  const feed = await loadFeed(supabase, product.id, filter, now, product.threshold);
  const rivals = new Map(product.competitors.map((c) => [c.id, c.name]));
  const current = feedHref(filter, { view: filter.view });

  return (
    <div className="flex flex-col gap-6">
      {firstRunActive(progress) ? <FirstRunProgress progress={progress} /> : null}
      <Tabs
        label="Views"
        current={current}
        items={FEED_VIEWS.map((view) => ({
          href: feedHref(filter, { view }),
          label: `${VIEW_LABELS[view]} ${feed.counts[view]}`,
        }))}
      />
      <FilterBar filter={filter} defaultMin={product.threshold} rivals={product.competitors} />
      {feed.items.length === 0 ? (
        <EmptyState title="Nothing here yet">
          Try another view, lower the minimum match, add search terms in Settings, or open the
          searches below.
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-4">
          {feed.items.map((item) => (
            <li key={item.id} id={`post-${item.id}`}>
              <PostCard
                item={item}
                now={now}
                rivalName={item.competitorId ? rivals.get(item.competitorId) : null}
                setState={setPostState}
              />
            </li>
          ))}
        </ol>
      )}
      {feed.hasMore ? (
        <Link
          href={feedHref(filter, { page: filter.page + 1 })}
          className="self-center text-accent underline"
          scroll={false}
        >
          Load more
        </Link>
      ) : null}
      <SearchLinksPanel
        terms={product.terms}
        subreddits={product.subreddits}
        sources={linkSources()}
      />
    </div>
  );
}

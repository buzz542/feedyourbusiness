import type { Metadata } from "next";
import Link from "next/link";
import { ReplyView } from "@/components/app/reply-view";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireEntitledUser } from "@/server/auth/entitled";
import { firstRunActive } from "@/server/pipeline/first-run";
import { loadFirstRunProgress } from "@/server/pipeline/first-run-server";
import { isFeedSource, parseFeedParams, withEnabledSource } from "@/server/store/feed";
import { loadFeed, loadReplyProduct } from "@/server/store/feed-supabase";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { collectSources, linkSources } from "@/sources/registry";
import { setPostState } from "./actions";

export const metadata: Metadata = { title: "Reply" };
export const dynamic = "force-dynamic";

/**
 * The Reply tab (docs/PLAN.md 4.4): checks entitlement, loads the product and the feed, and hands
 * them to ReplyView (src/components/app/reply-view.tsx), which renders the main column.
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

  const sources = collectSources()
    .map((s) => s.id)
    .filter(isFeedSource);
  const filter = withEnabledSource(parseFeedParams(search), sources);
  const progress = await loadFirstRunProgress(product.id);
  const now = new Date();
  const feed = await loadFeed(supabase, product.id, filter, now, product.threshold);

  return (
    <ReplyView
      filter={filter}
      defaultMin={product.threshold}
      feed={feed}
      now={now}
      rivals={product.competitors}
      sources={sources}
      terms={product.terms}
      subreddits={product.subreddits}
      links={linkSources()}
      firstRun={firstRunActive(progress) ? progress : null}
      setState={setPostState}
    />
  );
}

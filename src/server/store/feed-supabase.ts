import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  applyConditions,
  FEED_COLUMNS,
  FEED_VIEWS,
  feedConditions,
  PAGE_SIZE,
  toFeedItem,
  type FeedFilter,
  type FeedPage,
  type FeedView,
} from "./feed";

class FeedLoadError extends Error {
  override name = "FeedLoadError";
}

/**
 * The Reply feed through the signed-in user's client (RLS applies). Sorted by match score, then
 * newest (4.4); "Load more" widens the page, so a bookmarked page shows the same cards.
 */
export async function loadFeed(
  client: SupabaseClient<Database>,
  productId: string,
  filter: FeedFilter,
  now: Date,
  defaultMin: number,
): Promise<FeedPage> {
  const limit = filter.page * PAGE_SIZE;
  const list = applyConditions(
    client.from("feed_items").select(FEED_COLUMNS),
    feedConditions(productId, filter, filter.view, now, defaultMin),
  )
    .order("relevance", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(0, limit);
  const count = (view: FeedView) =>
    applyConditions(
      client.from("feed_items").select("id", { count: "exact", head: true }),
      feedConditions(productId, filter, view, now, defaultMin),
    );
  const [rows, ...counts] = await Promise.all([list, ...FEED_VIEWS.map(count)]);
  if (rows.error) throw new FeedLoadError(rows.error.code);
  for (const c of counts) if (c.error) throw new FeedLoadError(c.error.code);
  const data = rows.data ?? [];
  return {
    items: data.slice(0, limit).map(toFeedItem),
    hasMore: data.length > limit,
    counts: Object.fromEntries(FEED_VIEWS.map((v, i) => [v, counts[i]?.count ?? 0])) as Record<
      FeedView,
      number
    >,
  };
}

export interface ReplyProduct {
  id: string;
  threshold: number;
  subreddits: string[];
  terms: string[];
  competitors: { id: string; name: string }[];
}

/** The signed-in owner's product with what the Reply tab needs around the feed. */
export async function loadReplyProduct(
  client: SupabaseClient<Database>,
  ownerId: string,
): Promise<ReplyProduct | null> {
  const product = await client
    .from("products")
    .select("id, relevance_threshold, subreddits")
    .eq("owner_id", ownerId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (product.error) throw new FeedLoadError(product.error.code);
  if (!product.data) return null;
  const [terms, competitors] = await Promise.all([
    client
      .from("search_terms")
      .select("term")
      .eq("product_id", product.data.id)
      .eq("active", true)
      .order("created_at")
      .limit(40),
    client
      .from("competitors")
      .select("id, name")
      .eq("product_id", product.data.id)
      .order("name")
      .limit(20),
  ]);
  if (terms.error) throw new FeedLoadError(terms.error.code);
  if (competitors.error) throw new FeedLoadError(competitors.error.code);
  return {
    id: product.data.id,
    threshold: product.data.relevance_threshold,
    subreddits: product.data.subreddits ?? [],
    terms: (terms.data ?? []).map((t) => t.term),
    competitors: competitors.data ?? [],
  };
}

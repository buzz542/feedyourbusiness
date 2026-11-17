import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { FEED_VIEWS, type ViewCounts } from "@/lib/feed-views";
import {
  applyConditions,
  FEED_COLUMNS,
  feedConditions,
  PAGE_SIZE,
  parseFeedParams,
  toFeedItem,
  type FeedFilter,
  type FeedPage,
} from "./feed";

class FeedLoadError extends Error {
  override name = "FeedLoadError";
}

/**
 * The Reply feed through the signed-in user's client (RLS applies). Sorted by match score, then
 * newest (4.4); "Load more" widens the page, so a bookmarked page shows the same cards. `total`
 * counts the whole view with the filters applied.
 */
export async function loadFeed(
  client: SupabaseClient<Database>,
  productId: string,
  filter: FeedFilter,
  now: Date,
  defaultMin: number,
): Promise<FeedPage> {
  const limit = filter.page * PAGE_SIZE;
  const conditions = feedConditions(productId, filter, filter.view, now, defaultMin);
  const [rows, total] = await Promise.all([
    applyConditions(client.from("feed_items").select(FEED_COLUMNS), conditions)
      .order("relevance", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(0, limit),
    applyConditions(
      client.from("feed_items").select("id", { count: "exact", head: true }),
      conditions,
    ),
  ]);
  if (rows.error) throw new FeedLoadError(rows.error.code);
  if (total.error) throw new FeedLoadError(total.error.code);
  const data = rows.data ?? [];
  return {
    items: data.slice(0, limit).map(toFeedItem),
    hasMore: data.length > limit,
    total: total.count ?? 0,
  };
}

/**
 * The side panel's counts (docs/PLAN.md 4.4): every view of the owner's product with no filters
 * but the product's minimum match, so a count is what the view shows when opened. Null before
 * there is a product. The browser keeps them right as cards change (src/lib/feed-views.ts).
 */
export async function loadNavCounts(
  client: SupabaseClient<Database>,
  ownerId: string,
  now: Date,
): Promise<{ counts: ViewCounts; threshold: number } | null> {
  const product = await client
    .from("products")
    .select("id, relevance_threshold")
    .eq("owner_id", ownerId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (product.error) throw new FeedLoadError(product.error.code);
  if (!product.data) return null;
  const { id, relevance_threshold: threshold } = product.data;
  const filter = parseFeedParams({});
  const results = await Promise.all(
    FEED_VIEWS.map((view) =>
      applyConditions(
        client.from("feed_items").select("id", { count: "exact", head: true }),
        feedConditions(id, filter, view, now, threshold),
      ),
    ),
  );
  for (const r of results) if (r.error) throw new FeedLoadError(r.error.code);
  return {
    counts: Object.fromEntries(FEED_VIEWS.map((v, i) => [v, results[i]?.count ?? 0])) as ViewCounts,
    threshold,
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

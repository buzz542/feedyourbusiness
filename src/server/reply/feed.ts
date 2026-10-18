import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  FEED_CATEGORIES,
  FEED_PAGE_SIZE,
  FEED_SOURCES,
  type FeedCategory,
  type FeedFilters,
  type FeedSource,
} from "@/lib/reply-filters";
import type { Database } from "@/types/database";

/**
 * The Reply tab's cards and counts (docs/PLAN.md 4.4), from `reply_feed` and `reply_counts` with
 * the signed-in user's client, so row-level security limits them to the user's own product.
 */

export interface FeedCard {
  /** The product_posts id: what Save, Mark replied and Hide act on. */
  id: string;
  relevance: number;
  category: FeedCategory;
  reason: string;
  state: "new" | "saved" | "replied" | "hidden";
  linkedAt: Date;
  /** Offsets into the excerpt. */
  highlight: { start: number; end: number } | null;
  toolMentioned: string | null;
  rival: { id: string; name: string; issue: string | null; switching: boolean } | null;
  source: FeedSource;
  community: string | null;
  url: string;
  excerpt: string;
  postedAt: Date;
}

export interface FeedCounts {
  today: number;
  all: number;
  saved: number;
  replied: number;
}

export interface Feed {
  cards: FeedCard[];
  counts: FeedCounts;
  hasMore: boolean;
}

const Row = z.object({
  id: z.string(),
  relevance: z.number().int().min(0).max(100),
  category: z.enum(FEED_CATEGORIES),
  reason: z.string(),
  state: z.enum(["new", "saved", "replied", "hidden"]),
  created_at: z.string(),
  highlight_start: z.number().int().nullable(),
  highlight_end: z.number().int().nullable(),
  tool_mentioned: z.string().nullable(),
  competitor_id: z.string().nullable(),
  competitor_name: z.string().nullable(),
  rival_issue: z.string().nullable(),
  switching: z.boolean(),
  source: z.enum(FEED_SOURCES),
  community: z.string().nullable(),
  // Every stored link is https on its source's link host; anything else is not rendered.
  url: z.string().regex(/^https:\/\//),
  excerpt: z.string(),
  posted_at: z.string(),
});

const Counts = z.object({
  today: z.number(),
  all_posts: z.number(),
  saved: z.number(),
  replied: z.number(),
});

/** A card, or null for a row it cannot read (it is left out, never shown half-read). */
export function toCard(raw: unknown): FeedCard | null {
  const parsed = Row.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const highlight =
    r.highlight_start !== null &&
    r.highlight_end !== null &&
    r.highlight_start >= 0 &&
    r.highlight_end > r.highlight_start &&
    r.highlight_end <= r.excerpt.length
      ? { start: r.highlight_start, end: r.highlight_end }
      : null;
  return {
    id: r.id,
    relevance: r.relevance,
    category: r.category,
    reason: r.reason,
    state: r.state,
    linkedAt: new Date(r.created_at),
    highlight,
    toolMentioned: r.tool_mentioned,
    rival:
      r.competitor_id && r.competitor_name
        ? {
            id: r.competitor_id,
            name: r.competitor_name,
            issue: r.rival_issue,
            switching: r.switching,
          }
        : null,
    source: r.source,
    community: r.community,
    url: r.url,
    excerpt: r.excerpt,
    postedAt: new Date(r.posted_at),
  };
}

export function createFeedLoader(db: Pick<SupabaseClient<Database>, "rpc">) {
  return async function loadFeed(
    productId: string,
    filters: FeedFilters,
    now: Date,
  ): Promise<Feed> {
    const shared = {
      p_product: productId,
      p_category: filters.category ?? undefined,
      p_source: filters.source ?? undefined,
      p_competitor: filters.rival ?? undefined,
      p_min_relevance: filters.min,
      p_query: filters.q ?? undefined,
      p_now: now.toISOString(),
    };
    const shown = filters.page * FEED_PAGE_SIZE;
    const [rows, counts] = await Promise.all([
      db.rpc("reply_feed", {
        p_product: shared.p_product,
        p_view: filters.view,
        p_category: shared.p_category,
        p_source: shared.p_source,
        p_competitor: shared.p_competitor,
        p_min_relevance: shared.p_min_relevance,
        p_query: shared.p_query,
        p_limit: shown + 1,
        p_offset: 0,
        p_now: shared.p_now,
      }),
      db.rpc("reply_counts", shared),
    ]);
    if (rows.error || counts.error) throw new Error("Supabase: could not load the feed");
    const cards = (rows.data ?? []).map(toCard).filter((c): c is FeedCard => c !== null);
    const total = Counts.safeParse(counts.data?.[0]);
    return {
      cards: cards.slice(0, shown),
      hasMore: (rows.data?.length ?? 0) > shown,
      counts: total.success
        ? {
            today: total.data.today,
            all: total.data.all_posts,
            saved: total.data.saved,
            replied: total.data.replied,
          }
        : { today: 0, all: 0, saved: 0, replied: 0 },
    };
  };
}

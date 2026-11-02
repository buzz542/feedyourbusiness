import { z } from "zod";

/**
 * The Reply tab's feed (docs/PLAN.md 4.4): views, filters in the URL, conditions and the loader.
 * The conditions are plain data, so the Supabase adapter and the PGlite test apply the same list.
 * Reads go through the user's own client on the `feed_items` view (security invoker), so RLS
 * decides what anyone can see; the product filter only narrows it.
 */

export const FEED_VIEWS = ["today", "all", "saved", "replied"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

export const CATEGORIES = [
  "looking_for_tool",
  "pain_point",
  "mentions_you",
  "mentions_competitor",
  "wish",
] as const;
export type FeedCategory = (typeof CATEGORIES)[number];

export const FEED_SOURCES = ["reddit", "hackernews", "bluesky", "x"] as const;
export type FeedSource = (typeof FEED_SOURCES)[number];

export const PAGE_SIZE = 50;
const MAX_PAGES = 20;

const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);

const Params = z.object({
  view: z.enum(FEED_VIEWS).catch("today"),
  category: z.enum(CATEGORIES).optional().catch(undefined),
  source: z.enum(FEED_SOURCES).optional().catch(undefined),
  rival: z.uuid().optional().catch(undefined),
  min: z.coerce.number().int().min(40).max(95).optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((s) => s || undefined)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(MAX_PAGES).catch(1),
});

export type FeedFilter = z.infer<typeof Params>;

/** Bookmarkable filters from the URL; anything unreadable falls back to the default. */
export function parseFeedParams(
  search: Readonly<Record<string, string | string[] | undefined>>,
): FeedFilter {
  return Params.parse({
    view: one(search.view),
    category: one(search.category),
    source: one(search.source),
    rival: one(search.rival),
    min: one(search.min),
    q: one(search.q),
    page: one(search.page) ?? 1,
  });
}

/** The URL for the filter with some fields changed; defaults are left out. Changing a filter resets the page. */
export function feedHref(filter: FeedFilter, change: Partial<FeedFilter> = {}): string {
  const next = { ...filter, page: 1, ...change };
  const params = new URLSearchParams();
  if (next.view !== "today") params.set("view", next.view);
  for (const key of ["category", "source", "rival", "q"] as const) {
    const value = next[key];
    if (value) params.set(key, value);
  }
  if (next.min !== undefined) params.set("min", String(next.min));
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/app/reply?${query}` : "/app/reply";
}

export type FeedColumn =
  | "product_id"
  | "state"
  | "created_at"
  | "category"
  | "source"
  | "competitor_id"
  | "relevance"
  | "excerpt";

export type Condition =
  | { column: FeedColumn; op: "eq" | "neq" | "gte"; value: string | number }
  | { column: FeedColumn; op: "in"; value: readonly string[] }
  | { column: FeedColumn; op: "ilike"; value: string };

/** `%`, `_` and `\` match themselves in a text search. */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const DAY_MS = 24 * 60 * 60 * 1000;

export function viewConditions(view: FeedView, now: Date): Condition[] {
  switch (view) {
    case "today":
      return [
        { column: "state", op: "in", value: ["new", "saved"] },
        { column: "created_at", op: "gte", value: new Date(now.getTime() - DAY_MS).toISOString() },
      ];
    case "all":
      return [{ column: "state", op: "neq", value: "hidden" }];
    case "saved":
      return [{ column: "state", op: "eq", value: "saved" }];
    case "replied":
      return [{ column: "state", op: "eq", value: "replied" }];
  }
}

/** Every condition for one view of one product's feed with the filters applied. */
export function feedConditions(
  productId: string,
  filter: FeedFilter,
  view: FeedView,
  now: Date,
  defaultMin: number,
): Condition[] {
  const conditions: Condition[] = [
    { column: "product_id", op: "eq", value: productId },
    ...viewConditions(view, now),
    { column: "relevance", op: "gte", value: filter.min ?? defaultMin },
  ];
  if (filter.category) conditions.push({ column: "category", op: "eq", value: filter.category });
  if (filter.source) conditions.push({ column: "source", op: "eq", value: filter.source });
  if (filter.rival) conditions.push({ column: "competitor_id", op: "eq", value: filter.rival });
  if (filter.q) conditions.push({ column: "excerpt", op: "ilike", value: likePattern(filter.q) });
  return conditions;
}

export interface FeedItem {
  id: string;
  state: "new" | "saved" | "replied" | "hidden";
  relevance: number;
  category: FeedCategory;
  reason: string;
  createdAt: string;
  highlightStart: number | null;
  highlightEnd: number | null;
  competitorId: string | null;
  toolMentioned: string | null;
  switching: boolean;
  source: FeedSource;
  url: string;
  excerpt: string;
  postedAt: string;
  community: string | null;
}

export interface FeedPage {
  items: FeedItem[];
  hasMore: boolean;
  counts: Record<FeedView, number>;
}

/** The part of a Supabase query builder the feed uses. */
export interface FilterBuilder<T> {
  eq(column: string, value: unknown): T;
  neq(column: string, value: unknown): T;
  gte(column: string, value: unknown): T;
  in(column: string, values: readonly unknown[]): T;
  ilike(column: string, pattern: string): T;
}

export function applyConditions<T extends FilterBuilder<T>>(query: T, conditions: Condition[]): T {
  let q = query;
  for (const c of conditions) {
    if (c.op === "in") q = q.in(c.column, c.value);
    else if (c.op === "ilike") q = q.ilike(c.column, c.value);
    else q = q[c.op](c.column, c.value);
  }
  return q;
}

export const FEED_COLUMNS =
  "id, state, relevance, category, reason, created_at, highlight_start, highlight_end, competitor_id, tool_mentioned, switching, source, url, excerpt, posted_at, community";

type Row = {
  id: string;
  state: string;
  relevance: number;
  category: string;
  reason: string;
  created_at: string;
  highlight_start: number | null;
  highlight_end: number | null;
  competitor_id: string | null;
  tool_mentioned: string | null;
  switching: boolean;
  source: string;
  url: string;
  excerpt: string;
  posted_at: string;
  community: string | null;
};

export const toFeedItem = (r: Row): FeedItem => ({
  id: r.id,
  state: r.state as FeedItem["state"],
  relevance: r.relevance,
  category: r.category as FeedCategory,
  reason: r.reason,
  createdAt: r.created_at,
  highlightStart: r.highlight_start,
  highlightEnd: r.highlight_end,
  competitorId: r.competitor_id,
  toolMentioned: r.tool_mentioned,
  switching: r.switching,
  source: r.source as FeedSource,
  url: r.url,
  excerpt: r.excerpt,
  postedAt: r.posted_at,
  community: r.community,
});

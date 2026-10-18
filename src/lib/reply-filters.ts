/**
 * The Reply tab's view and filters, read from and written to the URL (docs/PLAN.md 4.4) so a view
 * can be bookmarked. Anything unknown falls back to its default: the URL is user input.
 */

export const FEED_VIEWS = ["today", "all", "saved", "replied"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

export const FEED_CATEGORIES = [
  "looking_for_tool",
  "pain_point",
  "mentions_you",
  "mentions_competitor",
  "wish",
] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

/** Collect sources a card can come from. */
export const FEED_SOURCES = ["reddit", "hackernews", "bluesky", "x"] as const;
export type FeedSource = (typeof FEED_SOURCES)[number];

export const FEED_PAGE_SIZE = 50;
/** "Load more" stops here: 500 cards. */
export const MAX_FEED_PAGE = 10;
const MIN_MATCH = 40;
const MAX_MATCH = 95;
const MAX_QUERY = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FeedFilters {
  view: FeedView;
  category: FeedCategory | null;
  source: FeedSource | null;
  /** A competitor's id. */
  rival: string | null;
  /** Minimum match, 40 to 95; the product's threshold by default. */
  min: number;
  /** Text to find within excerpts. */
  q: string | null;
  /** Pages loaded so far (Load more), 1 to MAX_FEED_PAGE. */
  page: number;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const oneOf = <T extends string>(list: readonly T[], value: string | undefined): T | null =>
  value !== undefined && (list as readonly string[]).includes(value) ? (value as T) : null;

function wholeNumber(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,3}$/.test(value) ? Number(value) : null;
}

const clampMatch = (n: number) => Math.min(MAX_MATCH, Math.max(MIN_MATCH, Math.round(n)));

export function parseFeedFilters(params: Params, productThreshold: number): FeedFilters {
  const min = wholeNumber(first(params.min));
  const page = wholeNumber(first(params.page));
  const q = first(params.q)?.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY) ?? "";
  const rival = first(params.rival);
  return {
    view: oneOf(FEED_VIEWS, first(params.view)) ?? "today",
    category: oneOf(FEED_CATEGORIES, first(params.category)),
    source: oneOf(FEED_SOURCES, first(params.source)),
    rival: rival && UUID.test(rival) ? rival.toLowerCase() : null,
    min: min !== null && min >= MIN_MATCH && min <= MAX_MATCH ? min : clampMatch(productThreshold),
    q: q || null,
    page: page === null || page < 1 ? 1 : Math.min(page, MAX_FEED_PAGE),
  };
}

/**
 * The URL for the current filters with `change` applied. Changing any filter starts again at
 * page 1; no change keeps the page. Defaults are left out, so the plain view is just /app/reply.
 */
export function feedHref(
  filters: FeedFilters,
  change: Partial<FeedFilters>,
  productThreshold: number,
): string {
  const next: FeedFilters = {
    ...filters,
    ...change,
    page:
      "page" in change ? (change.page ?? 1) : Object.keys(change).length === 0 ? filters.page : 1,
  };
  const params = new URLSearchParams();
  if (next.view !== "today") params.set("view", next.view);
  if (next.category) params.set("category", next.category);
  if (next.source) params.set("source", next.source);
  if (next.rival) params.set("rival", next.rival);
  if (next.min !== clampMatch(productThreshold)) params.set("min", String(next.min));
  if (next.q) params.set("q", next.q);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/app/reply?${query}` : "/app/reply";
}

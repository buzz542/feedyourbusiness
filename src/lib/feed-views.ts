/**
 * The Reply tab's views (docs/PLAN.md 4.4, with Hidden added so a hidden post can be found and
 * brought back). Plain data with no dependencies, so the side panel can keep its counts right in
 * the browser when a card changes state. `viewConditions` in src/server/store/feed.ts is the SQL
 * side; tests/db/feed.test.ts checks that both put every post in the same views.
 */

export const FEED_VIEWS = ["today", "all", "saved", "replied", "hidden"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];
export type ViewCounts = Record<FeedView, number>;

export type PostState = "new" | "saved" | "replied" | "hidden";

/** "Today" is the posts collected in the last 24 hours. */
export const TODAY_MS = 24 * 60 * 60 * 1000;

export interface CountedPost {
  state: PostState;
  /** When the post was collected for this product (the link's created_at). */
  createdAt: string;
  relevance: number;
}

/** Whether a post is listed in a view, with no filters but the minimum match. */
export function inView(view: FeedView, post: CountedPost, now: Date, min: number): boolean {
  if (post.relevance < min) return false;
  switch (view) {
    case "today":
      return (
        (post.state === "new" || post.state === "saved") &&
        Date.parse(post.createdAt) >= now.getTime() - TODAY_MS
      );
    case "all":
      return post.state !== "hidden";
    case "saved":
    case "replied":
    case "hidden":
      return post.state === view;
  }
}

/** The counts after one post moves from one state to another. Never below zero. */
export function countsAfterMove(
  counts: ViewCounts,
  post: Omit<CountedPost, "state">,
  from: PostState,
  to: PostState,
  now: Date,
  min: number,
): ViewCounts {
  const next = { ...counts };
  for (const view of FEED_VIEWS) {
    const was = inView(view, { ...post, state: from }, now, min);
    const is = inView(view, { ...post, state: to }, now, min);
    if (was !== is) next[view] = Math.max(0, next[view] + (is ? 1 : -1));
  }
  return next;
}

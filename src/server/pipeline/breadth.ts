/**
 * How niche a product is, judged on its first run (the founder, 27 Nov 2026).
 *
 * The free sources (Hacker News, Bluesky) run first and read the past month. A strong match is a
 * stored post scoring STRONG_SCORE or more, posted in the last RECENT_DAYS. With WIDE_MIN_STRONG or
 * more of them the topic is wide: the paid source (Reddit) reads only the past week, and the feed
 * minimum stays at the default 60. With fewer it is niche: Reddit reads the past month, and once
 * every first-run source has finished the feed minimum drops to 50 (only if it is still the
 * default, so a minimum the user set is kept). Later runs read recent posts only.
 */

export const STRONG_SCORE = 60;
export const RECENT_DAYS = 14;
export const WIDE_MIN_STRONG = 10;

export const WIDE_WINDOW_HOURS = 7 * 24;
export const NICHE_WINDOW_HOURS = 30 * 24;

export const DEFAULT_THRESHOLD = 60;
export const NICHE_THRESHOLD = 50;

/** The paid source waits at most this long for the free sources, then reads the month. */
export const FREE_WAIT_MS = 10 * 60_000;
/** How soon a waiting paid first run looks again. */
export const FREE_RECHECK_MS = 20_000;

export type Breadth = "wide" | "niche";

export const breadthOf = (strongRecent: number): Breadth =>
  strongRecent >= WIDE_MIN_STRONG ? "wide" : "niche";

export const firstRunWindowHours = (breadth: Breadth): number =>
  breadth === "wide" ? WIDE_WINDOW_HOURS : NICHE_WINDOW_HOURS;

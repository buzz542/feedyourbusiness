import { SOURCE_LABELS } from "@/server/reply/tips";

/** Pure helpers shared by the card and the detail panel. */

/** "Reddit · r/SaaS", "Hacker News", "Bluesky" (docs/PLAN.md 4.4). */
export function sourceLine(source: string, community: string | null): string {
  const label = SOURCE_LABELS[source] ?? source;
  return community && community !== label ? `${label} · ${community}` : label;
}

/** "15m", "3h", "2d": the post's age. */
export function age(postedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(postedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Stored highlight offsets count code points (as Postgres counts the excerpt); <Highlight> slices
 * UTF-16 units. Converts, or returns null for a range that does not fit.
 */
export function unitRange(
  text: string,
  start: number | null,
  end: number | null,
): { start: number; end: number } | null {
  if (start === null || end === null) return null;
  const points = Array.from(text);
  if (start < 0 || end <= start || end > points.length) return null;
  const from = points.slice(0, start).join("").length;
  return { start: from, end: from + points.slice(start, end).join("").length };
}

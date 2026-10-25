/**
 * Checks on synthesis text before it is saved (docs/PLAN.md 8.4, 2.3.4): a summary that shares 8
 * or more consecutive words with an input excerpt is a quote; a handle (@name, u/name) is a name.
 */

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);

export const QUOTE_WORDS = 8;

/** True when `text` has `n` or more consecutive words that also appear in a row in any excerpt. */
export function quotesAny(text: string, excerpts: readonly string[], n = QUOTE_WORDS): boolean {
  const mine = words(text);
  if (mine.length < n) return false;
  const windows = new Set<string>();
  for (const excerpt of excerpts) {
    const theirs = words(excerpt);
    for (let i = 0; i + n <= theirs.length; i++) windows.add(theirs.slice(i, i + n).join(" "));
  }
  for (let i = 0; i + n <= mine.length; i++)
    if (windows.has(mine.slice(i, i + n).join(" "))) return true;
  return false;
}

/** @name, u/name or /u/name: a person's handle. */
export function hasHandle(text: string): boolean {
  return /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,}|(^|[^\p{L}\p{N}_])\/?u\/[\p{L}\p{N}_-]{2,}/iu.test(
    text,
  );
}

export const textProblem = (
  text: string,
  excerpts: readonly string[],
): "quote" | "handle" | null =>
  hasHandle(text) ? "handle" : quotesAny(text, excerpts) ? "quote" : null;

/** Trend against last week's count for the same key (docs/PLAN.md 8.4). */
export function trendFor(
  current: number,
  last: number | undefined,
): "new" | "up" | "down" | "flat" {
  if (last === undefined) return "new";
  if (last === 0) return current > 0 ? "up" : "flat";
  const change = (current - last) / last;
  if (change >= 0.2) return "up";
  if (change <= -0.2) return "down";
  return "flat";
}

/** Monday of the ISO week containing `now`, in London time, as YYYY-MM-DD. */
export function weekOf(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const offset = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday ?? "Mon");
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return new Date(local - offset * 86_400_000).toISOString().slice(0, 10);
}

export const previousWeek = (week: string): string =>
  new Date(Date.parse(`${week}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);

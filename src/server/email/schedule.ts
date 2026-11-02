/**
 * 08:00 Europe/London (docs/PLAN.md 7.2, 11), across the daylight saving change. On the Hobby plan
 * only the daily cron runs (06:00 UTC), so a digest is due at that run; once the 10-minute tick
 * exists (Vercel Pro, section 13) it waits for 08:00 UK. The Pro switch sets JOB_TICK_DECLARED.
 */

export const JOB_TICK_DECLARED = false;

const parts = (at: Date) => {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => f.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
};

/** The London calendar date of an instant, YYYY-MM-DD. */
export const londonDate = (at: Date) => parts(at).date;

/** The instant 08:00 London time falls on a London date. */
export function londonEight(date: string): Date {
  for (const offset of [0, 1]) {
    const at = new Date(`${date}T${String(8 - offset).padStart(2, "0")}:00:00Z`);
    const p = parts(at);
    if (p.date === date && p.hour === 8) return at;
  }
  throw new RangeError("No 08:00 in London on that date");
}

/** The next 08:00 London time at or after `now`. */
export function nextLondonEight(now: Date): Date {
  const today = londonEight(londonDate(now));
  if (today.getTime() >= now.getTime()) return today;
  return londonEight(londonDate(new Date(now.getTime() + 24 * 3_600_000)));
}

/** When a digest enqueued now should go out. */
export const digestRunAfter = (now: Date, tick = JOB_TICK_DECLARED) =>
  tick ? nextLondonEight(now) : now;

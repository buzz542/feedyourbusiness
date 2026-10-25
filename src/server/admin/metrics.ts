/**
 * Admin metrics (docs/PLAN.md 4.8, 12.6) from the first-party events table and subscription
 * statuses: activation, weekly active users, replies marked per user per week, trial to paid.
 * Counts only: no post text, no emails, no user ids in the output.
 */

export interface EventRow {
  name: string;
  user_id: string | null;
  at: string;
}

export interface Metrics {
  signups30d: number;
  /** Share of last 30 days' sign-ups who confirmed a product. */
  activation: number | null;
  weeklyActiveUsers: number;
  repliesPerActiveUserPerWeek: number | null;
  /** Paying (active) over everyone who ever started a trial. */
  trialToPaid: number | null;
  trialsStarted: number;
  paying: number;
}

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 100) / 100;

export function computeMetrics(
  events: readonly EventRow[],
  statuses: readonly (string | null)[],
  everTrialed: number,
  now: Date,
): Metrics {
  const t = now.getTime();
  const within = (days: number) => (e: EventRow) => t - Date.parse(e.at) <= days * DAY;
  const users = (rows: readonly EventRow[]) =>
    new Set(rows.map((e) => e.user_id).filter((u): u is string => u !== null));

  const signups = users(events.filter((e) => e.name === "signed_up" && within(30)(e)));
  const confirmed = users(events.filter((e) => e.name === "product_confirmed"));
  const activated = [...signups].filter((u) => confirmed.has(u)).length;
  const week = events.filter(within(7));
  const active = users(week);
  const replies = week.filter((e) => e.name === "post_replied").length;
  const paying = statuses.filter((s) => s === "active").length;

  return {
    signups30d: signups.size,
    activation: signups.size ? round(activated / signups.size) : null,
    weeklyActiveUsers: active.size,
    repliesPerActiveUserPerWeek: active.size ? round(replies / active.size) : null,
    trialToPaid: everTrialed ? round(paying / everTrialed) : null,
    trialsStarted: everTrialed,
    paying,
  };
}

/**
 * Admin views (docs/PLAN.md 4.8, 12.6): source health, costs and metrics, computed from rows the
 * admin page reads with the service role. Pure, and holding no post text, emails or author data:
 * only counts, sums, error class names and dates.
 */

export interface SourceInfo {
  id: string;
  displayName: string;
  enabled: boolean;
  dailyBudget: number;
  monthlyCap: number | null;
}

export interface JobRow {
  source: string | null;
  kind: string;
  status: string;
  last_error: string | null;
  finished_at: string | null;
  updated_at: string;
}

export interface LedgerRow {
  source?: string;
  product_id?: string;
  usage_date: string;
  reads?: number;
  cost_usd: number | string;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (d: Date) => utcDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
const num = (v: number | string | undefined) => Number(v ?? 0) || 0;
const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function sourceHealth(input: {
  sources: readonly SourceInfo[];
  jobs: readonly JobRow[];
  ledger: readonly LedgerRow[];
  now: Date;
}) {
  const today = utcDay(input.now);
  const month = monthStart(input.now);
  return input.sources.map((s) => {
    const jobs = input.jobs
      .filter((j) => j.source === s.id && (j.kind === "collect" || j.kind === "first_run"))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const failuresByClass: Record<string, number> = {};
    for (const j of jobs)
      if (j.status === "failed" && j.last_error)
        failuresByClass[j.last_error] = (failuresByClass[j.last_error] ?? 0) + 1;
    const ledger = input.ledger.filter((l) => l.source === s.id);
    return {
      id: s.id,
      name: s.displayName,
      enabled: s.enabled,
      lastRunAt: jobs[0]?.finished_at ?? jobs[0]?.updated_at ?? null,
      lastStatus: jobs[0]?.status ?? null,
      failuresByClass,
      usedToday: ledger.filter((l) => l.usage_date === today).reduce((t, l) => t + num(l.reads), 0),
      dailyBudget: s.dailyBudget,
      usedThisMonth: ledger
        .filter((l) => l.usage_date >= month)
        .reduce((t, l) => t + num(l.reads), 0),
      monthlyCap: s.monthlyCap,
    };
  });
}

type Spend = { vendor: number; model: number };

export function costSummary(input: {
  ledger: readonly LedgerRow[];
  llm: ReadonlyArray<{ product_id: string | null; created_at: string; cost_usd: number | string }>;
  now: Date;
}) {
  const month = monthStart(input.now);
  const days = new Map<string, Spend>();
  const products = new Map<string, Spend>();
  const add = (map: Map<string, Spend>, key: string, kind: keyof Spend, v: number) => {
    const row = map.get(key) ?? { vendor: 0, model: 0 };
    row[kind] = round(row[kind] + v);
    map.set(key, row);
  };
  for (const l of input.ledger) {
    if (l.usage_date < month) continue;
    add(days, l.usage_date, "vendor", num(l.cost_usd));
    if (l.product_id) add(products, l.product_id, "vendor", num(l.cost_usd));
  }
  for (const l of input.llm) {
    const d = l.created_at.slice(0, 10);
    if (d < month) continue;
    add(days, d, "model", num(l.cost_usd));
    if (l.product_id) add(products, l.product_id, "model", num(l.cost_usd));
  }
  const byDay = [...days]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => b.day.localeCompare(a.day));
  const byProduct = [...products]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.vendor + b.model - (a.vendor + a.model));
  return {
    byDay,
    byProduct,
    totalThisMonth: round(byDay.reduce((t, d) => t + d.vendor + d.model, 0)),
  };
}

export function metricsSummary(input: {
  events: ReadonlyArray<{ name: string; user_id: string | null; at: string }>;
  statuses: Readonly<Record<string, number>>;
  now: Date;
}) {
  const since = (days: number) => new Date(input.now.getTime() - days * 86_400_000).toISOString();
  const users = (name: string, from: string) =>
    new Set(
      input.events
        .filter((e) => e.name === name && e.at >= from && e.user_id)
        .map((e) => e.user_id),
    );
  const month = since(30);
  const week = since(7);
  const signedUp = users("signed_up", month);
  const activated = [...users("product_confirmed", month)].filter((u) => signedUp.has(u)).length;
  const active = users("feed_opened", week);
  const replies = input.events.filter((e) => e.name === "post_replied" && e.at >= week).length;
  return {
    signedUp30d: signedUp.size,
    activated30d: activated,
    weeklyActiveUsers: active.size,
    repliesPerActiveUserThisWeek: active.size === 0 ? 0 : round(replies / active.size),
    trialing: input.statuses.trialing ?? 0,
    paying: input.statuses.active ?? 0,
    ended: input.statuses.canceled ?? 0,
  };
}

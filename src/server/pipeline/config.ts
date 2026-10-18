import type { CollectSource } from "@/sources/types";

/** Descriptive, with a monitored contact (docs/PLAN.md 7.4), on every source request. */
export const SOURCE_USER_AGENT = "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)";

/**
 * BRIGHTDATA_MONTHLY_RECORD_CAP for vendor sources (docs/PLAN.md 7.7), default 20,000. New
 * collection may use 90 percent of it; the other 10 percent is held for deletion re-checks (2.3.6),
 * which may use the whole cap.
 */
export function monthlyCapFor(
  source: Pick<CollectSource, "access">,
  env: Readonly<Record<string, string | undefined>> = process.env,
  purpose: "collect" | "recheck" = "collect",
): number | null {
  if (source.access !== "vendor_api") return null;
  const raw = env.BRIGHTDATA_MONTHLY_RECORD_CAP?.trim();
  // A value that is not a whole number stops vendor calls rather than lifting the cap.
  const cap = raw === undefined || raw === "" ? 20_000 : /^\d+$/.test(raw) ? Number(raw) : 0;
  return purpose === "recheck" ? cap : Math.floor(cap * 0.9);
}

type Env = Readonly<Record<string, string | undefined>>;

/** The env var holding each paid source's per-product daily budget (docs/PLAN.md 7.6, 7.7). */
const BUDGET_ENV: Readonly<Record<string, string>> = {
  reddit: "REDDIT_DAILY_RECORDS_PER_PRODUCT",
  x: "X_DAILY_READS_PER_PRODUCT",
};

/**
 * A source's units per product per day: its env var when it has one (Reddit default 120, X default
 * 0, which means no calls), otherwise the module's own budget. A value that is not a whole number
 * stops the source rather than lifting the budget.
 */
export function dailyBudgetFor(
  source: Pick<CollectSource, "id" | "dailyBudget">,
  env: Env = process.env,
): number {
  const name = BUDGET_ENV[source.id];
  const raw = name ? env[name]?.trim() : undefined;
  if (raw === undefined || raw === "") return source.dailyBudget;
  return /^\d+$/.test(raw) ? Number(raw) : 0;
}

/**
 * Reddit's price per record from BRIGHTDATA_COST_PER_1K (docs/PLAN.md 7.7); other sources keep the
 * module's price. A price that cannot be read never counts as cheaper than the plan's $1.50.
 */
export function costPerUnitFor(
  source: Pick<CollectSource, "id" | "costPerUnitUsd">,
  env: Env = process.env,
): number {
  if (source.id !== "reddit") return source.costPerUnitUsd;
  const raw = env.BRIGHTDATA_COST_PER_1K?.trim() ?? "";
  const perThousand = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isFinite(perThousand)
    ? Math.max(perThousand, 0) / 1000
    : Math.max(source.costPerUnitUsd, 1.5 / 1000);
}

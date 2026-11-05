import "server-only";
import { dailyBudgetFor, monthlyCapFor } from "@/server/pipeline/config";
import { readAllPages } from "@/server/store/pages";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { isEnabled, sources, vendorClearance } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import { costSummary, metricsSummary, sourceHealth } from "./views";

class AdminLoadError extends Error {
  override name = "AdminLoadError";
  constructor(readonly code: string | undefined) {
    super("Admin data could not be read");
  }
}

const check = <T>(r: { data: T[] | null; error: { code?: string } | null }): T[] => {
  if (r.error) throw new AdminLoadError(r.error.code);
  return r.data ?? [];
};

/** Everything the admin page shows besides the removal queue (docs/PLAN.md 4.8). Service role. */
export async function loadAdminViews(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [jobs, ledger, llm, events, profiles] = await Promise.all([
    readAllPages(async (from, to) =>
      check(
        await admin
          .from("jobs")
          .select("source, kind, status, last_error, finished_at, updated_at")
          .in("kind", ["collect", "first_run"])
          .gte("updated_at", since30)
          .order("updated_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
    ),
    readAllPages(async (from, to) =>
      check(
        await admin
          .from("usage_ledger")
          .select("source, product_id, usage_date, reads, cost_usd")
          .gte("usage_date", month.toISOString().slice(0, 10))
          .order("usage_date")
          .order("id")
          .range(from, to),
      ),
    ),
    readAllPages(async (from, to) =>
      check(
        await admin
          .from("llm_usage")
          .select("product_id, created_at, cost_usd")
          .gte("created_at", month.toISOString())
          .order("created_at")
          .order("id")
          .range(from, to),
      ),
    ),
    readAllPages(async (from, to) =>
      check(
        await admin
          .from("events")
          .select("name, user_id, at")
          .gte("at", since30)
          .order("at")
          .order("id")
          .range(from, to),
      ),
    ),
    readAllPages(async (from, to) =>
      check(await admin.from("profiles").select("subscription_status").order("id").range(from, to)),
    ),
  ]);
  const statuses: Record<string, number> = {};
  for (const p of profiles) {
    const s = p.subscription_status ?? "none";
    statuses[s] = (statuses[s] ?? 0) + 1;
  }
  const collect = sources.filter((s): s is CollectSource => s.mode === "collect");
  return {
    health: sourceHealth({
      sources: collect.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        enabled: isEnabled(s) && !["dpa_missing", "notice_missing"].includes(vendorClearance(s)),
        dailyBudget: dailyBudgetFor(s),
        monthlyCap: monthlyCapFor(s),
      })),
      jobs,
      ledger,
      now,
    }),
    costs: costSummary({ ledger, llm, now }),
    metrics: metricsSummary({ events, statuses, now }),
  };
}

export type AdminViews = Awaited<ReturnType<typeof loadAdminViews>>;

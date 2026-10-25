import { monthlyCapFor } from "@/server/pipeline/config";
import { requireAdmin } from "@/server/admin/require-admin";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { isEnabled, killSwitchName, sources, vendorClearance } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";

export const dynamic = "force-dynamic";

/** Source health (docs/PLAN.md 4.8): last run, failures by class, budget today, vendor cap. */
export default async function SourceHealth() {
  await requireAdmin();
  const db = createSupabaseAdminClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [jobs, failed, ledger] = await Promise.all([
    db
      .from("jobs")
      .select("source, kind, status, finished_at, payload")
      .in("kind", ["collect", "first_run", "deletion_sync"])
      .not("source", "is", null)
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(200),
    db.from("jobs").select("source, last_error").eq("status", "failed").gte("updated_at", weekAgo),
    db.from("usage_ledger").select("source, reads, usage_date").gte("usage_date", monthStart),
  ]);
  if (jobs.error || failed.error || ledger.error)
    throw new Error("Supabase: could not load health");
  const collect = sources.filter((s): s is CollectSource => s.mode === "collect");
  return (
    <div>
      <h1 className="font-serif text-2xl tracking-tight">Source health</h1>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              {[
                "Source",
                "Switch",
                "Last run",
                "Failures (7 days)",
                "Used today",
                "Used this month",
                "Monthly cap",
              ].map((h) => (
                <th key={h} className="py-1 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {collect.map((s) => {
              const last = (jobs.data ?? []).find((j) => j.source === s.id && j.finished_at);
              const result =
                last &&
                last.payload &&
                typeof last.payload === "object" &&
                !Array.isArray(last.payload)
                  ? String((last.payload as Record<string, unknown>).result ?? last.status)
                  : null;
              const failures = (failed.data ?? []).filter((f) => f.source === s.id);
              const byClass = new Map<string, number>();
              for (const f of failures)
                byClass.set(
                  f.last_error ?? "Unknown",
                  (byClass.get(f.last_error ?? "Unknown") ?? 0) + 1,
                );
              const rows = (ledger.data ?? []).filter((l) => l.source === s.id);
              const usedToday = rows
                .filter((l) => l.usage_date === today)
                .reduce((n, l) => n + l.reads, 0);
              const usedMonth = rows.reduce((n, l) => n + l.reads, 0);
              const clearance = vendorClearance(s);
              return (
                <tr key={s.id} className="border-t border-rule align-top">
                  <td className="py-1 pr-4">{s.displayName}</td>
                  <td className="py-1 pr-4">
                    {isEnabled(s) ? "on" : "off"}
                    <span className="block text-xs text-muted">{killSwitchName(s)}</span>
                    {clearance !== "cleared" && clearance !== "not_vendor" ? (
                      <span className="block text-xs text-negative">{clearance}</span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-4">
                    {last?.finished_at
                      ? `${last.finished_at.slice(0, 16).replace("T", " ")} (${result})`
                      : "never"}
                  </td>
                  <td className="py-1 pr-4">
                    {[...byClass.entries()].map(([k, n]) => `${k} ×${n}`).join(", ") || "none"}
                  </td>
                  <td className="py-1 pr-4 tabular-nums">{usedToday}</td>
                  <td className="py-1 pr-4 tabular-nums">{usedMonth}</td>
                  <td className="py-1 tabular-nums">{monthlyCapFor(s) ?? "none"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

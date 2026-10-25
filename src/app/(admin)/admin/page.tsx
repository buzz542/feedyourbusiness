import { requireAdmin } from "@/server/admin/require-admin";
import { computeMetrics } from "@/server/admin/metrics";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** Metrics from first-party events (docs/PLAN.md 4.8): counts only. */
export default async function AdminMetrics() {
  await requireAdmin();
  const db = createSupabaseAdminClient();
  const [events, profiles] = await Promise.all([
    db.from("events").select("name, user_id, at").gte("at", since(31)).limit(50_000),
    db.from("profiles").select("subscription_status, stripe_subscription_id"),
  ]);
  if (events.error || profiles.error) throw new Error("Supabase: could not load metrics");
  const statuses = (profiles.data ?? []).map((p) => p.subscription_status);
  const everTrialed = (profiles.data ?? []).filter((p) => p.stripe_subscription_id).length;
  const m = computeMetrics(events.data ?? [], statuses, everTrialed, new Date());
  const rows: [string, string][] = [
    ["Sign-ups, last 30 days", String(m.signups30d)],
    ["Activation (confirmed a product)", pct(m.activation)],
    ["Weekly active users", String(m.weeklyActiveUsers)],
    [
      "Replies marked per active user, last 7 days",
      m.repliesPerActiveUserPerWeek?.toString() ?? "n/a",
    ],
    ["Trials started (ever)", String(m.trialsStarted)],
    ["Paying now", String(m.paying)],
    ["Trial to paid", pct(m.trialToPaid)],
  ];
  return (
    <div>
      <h1 className="font-serif text-2xl tracking-tight">Metrics</h1>
      <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-rule py-1">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

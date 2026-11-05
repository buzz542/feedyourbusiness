import type { AdminViews } from "@/server/admin/load";

const usd = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never");

/** Source health, costs and metrics (docs/PLAN.md 4.8): counts and sums only. */
export function AdminViewsPanel({ views }: { views: AdminViews }) {
  const { health, costs, metrics } = views;
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="health" className="flex flex-col gap-3">
        <h2 id="health" className="font-serif text-2xl tracking-tight">
          Source health
        </h2>
        <ul className="flex flex-col gap-2">
          {health.map((s) => (
            <li key={s.id} className="rounded-[2px] border border-rule p-3 text-sm">
              <p className="font-medium">
                {s.name}: {s.enabled ? "switched on" : "off"}
              </p>
              <p className="text-muted">
                Last run {when(s.lastRunAt)} ({s.lastStatus ?? "none"}). Today {s.usedToday} of{" "}
                {s.dailyBudget} per product. This month {s.usedThisMonth}
                {s.monthlyCap === null ? "" : ` of ${s.monthlyCap}`}.
              </p>
              {Object.keys(s.failuresByClass).length > 0 ? (
                <p className="text-muted">
                  Failures (30 days):{" "}
                  {Object.entries(s.failuresByClass)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="costs" className="flex flex-col gap-3">
        <h2 id="costs" className="font-serif text-2xl tracking-tight">
          Costs this month: {usd(costs.totalThisMonth)}
        </h2>
        <table className="text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="pr-4 font-normal">Day</th>
              <th className="pr-4 font-normal">Vendor</th>
              <th className="font-normal">Model</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {costs.byDay.map((d) => (
              <tr key={d.day}>
                <td className="pr-4">{d.day}</td>
                <td className="pr-4">{usd(d.vendor)}</td>
                <td>{usd(d.model)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-muted">
          Top products:{" "}
          {costs.byProduct.length === 0
            ? "none yet"
            : costs.byProduct
                .slice(0, 10)
                .map((p) => `${p.productId.slice(0, 8)} ${usd(p.vendor + p.model)}`)
                .join(", ")}
        </p>
      </section>
      <section aria-labelledby="metrics" className="flex flex-col gap-3">
        <h2 id="metrics" className="font-serif text-2xl tracking-tight">
          Metrics
        </h2>
        <ul className="flex flex-col gap-1 text-sm tabular-nums">
          <li>
            Signed up in 30 days: {metrics.signedUp30d}, of whom confirmed a product:{" "}
            {metrics.activated30d}
          </li>
          <li>Weekly active users: {metrics.weeklyActiveUsers}</li>
          <li>Replies marked per active user this week: {metrics.repliesPerActiveUserThisWeek}</li>
          <li>
            Trialing {metrics.trialing}, paying {metrics.paying}, ended {metrics.ended}
          </li>
        </ul>
      </section>
    </div>
  );
}

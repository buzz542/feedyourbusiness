import { requireAdmin } from "@/server/admin/require-admin";
import { createSupabaseAdminClient } from "@/server/supabase/admin";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Vendor and model spend per day and per product, last 30 days (docs/PLAN.md 4.8). */
export default async function Costs() {
  await requireAdmin();
  const db = createSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [ledger, llm] = await Promise.all([
    db
      .from("usage_ledger")
      .select("product_id, source, usage_date, cost_usd")
      .gte("usage_date", since.toISOString().slice(0, 10)),
    db
      .from("llm_usage")
      .select("product_id, task, created_at, cost_usd")
      .gte("created_at", since.toISOString()),
  ]);
  if (ledger.error || llm.error) throw new Error("Supabase: could not load costs");
  const byDay = new Map<string, { vendor: number; model: number }>();
  const byProduct = new Map<string, { vendor: number; model: number }>();
  const add = (
    map: Map<string, { vendor: number; model: number }>,
    key: string,
    kind: "vendor" | "model",
    n: number,
  ) => {
    const cur = map.get(key) ?? { vendor: 0, model: 0 };
    cur[kind] += Number(n);
    map.set(key, cur);
  };
  for (const r of ledger.data ?? []) {
    add(byDay, r.usage_date, "vendor", r.cost_usd);
    add(byProduct, r.product_id, "vendor", r.cost_usd);
  }
  for (const r of llm.data ?? []) {
    add(byDay, r.created_at.slice(0, 10), "model", r.cost_usd);
    add(byProduct, r.product_id ?? "preview", "model", r.cost_usd);
  }
  const table = (title: string, map: Map<string, { vendor: number; model: number }>) => (
    <section className="mt-6">
      <h2 className="font-serif text-xl tracking-tight">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-1 pr-4 font-medium">{title === "By day" ? "Day" : "Product"}</th>
            <th className="py-1 pr-4 font-medium">Data vendor</th>
            <th className="py-1 pr-4 font-medium">Models</th>
            <th className="py-1 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {[...map.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([k, v]) => (
              <tr key={k} className="border-t border-rule">
                <td className="py-1 pr-4 font-mono text-xs">{k}</td>
                <td className="py-1 pr-4 tabular-nums">{usd(v.vendor)}</td>
                <td className="py-1 pr-4 tabular-nums">{usd(v.model)}</td>
                <td className="py-1 tabular-nums">{usd(v.vendor + v.model)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
  return (
    <div>
      <h1 className="font-serif text-2xl tracking-tight">Costs, last 30 days</h1>
      {table("By day", byDay)}
      {table("By product", byProduct)}
    </div>
  );
}

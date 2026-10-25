import { requireAdmin } from "@/server/admin/require-admin";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { deleteAndSuppressAction } from "./actions";

export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(iso));

/** The removal queue, by due date (docs/PLAN.md 4.8). */
export default async function RemovalQueue() {
  await requireAdmin();
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("removal_requests")
    .select("id, link_or_handle, source, details, status, target_at, due_at, created_at")
    .in("status", ["received", "verified"])
    .order("due_at");
  if (error) throw new Error("Supabase: could not load the queue");
  const closed = await db
    .from("removal_requests")
    .select("id, status, handled_at")
    .not("handled_at", "is", null)
    .order("handled_at", { ascending: false })
    .limit(20);
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl tracking-tight">Removal queue</h1>
      {(data ?? []).length === 0 ? <p className="text-muted">Nothing waiting.</p> : null}
      <ul className="space-y-3">
        {(data ?? []).map((r) => (
          <li key={r.id} className="rounded-[2px] border border-rule p-4 text-sm">
            <p className="break-all font-medium">{r.link_or_handle}</p>
            <p className="mt-1 text-muted">
              {r.source ?? "no site given"} · received {when(r.created_at)} · aim{" "}
              {when(r.target_at)} · due {when(r.due_at)}
            </p>
            {r.details ? <p className="mt-1">{r.details}</p> : null}
            <form action={deleteAndSuppressAction} className="mt-3">
              <input type="hidden" name="id" value={r.id} />
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-[2px] bg-accent px-4 font-medium text-accent-ink hover:opacity-90"
              >
                Delete and suppress
              </button>
            </form>
          </li>
        ))}
      </ul>
      <h2 className="font-serif text-xl tracking-tight">Recently handled</h2>
      <ul className="text-sm">
        {(closed.data ?? []).map((r) => (
          <li key={r.id}>
            {r.status} · {r.handled_at ? when(r.handled_at) : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

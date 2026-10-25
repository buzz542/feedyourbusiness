import { getSessionUser } from "@/server/auth/session";
import { loadAppState } from "@/server/auth/app-state";
import { gateFor } from "@/server/auth/next-step";
import { renderRivalReport } from "@/server/rivals/export";
import { loadRivals } from "@/server/rivals/load";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The week's rival report as Markdown (docs/PLAN.md 4.5): aggregates only, no handles or quotes. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const state = await loadAppState(user.id);
  if (gateFor("rivals", state) || !state.product)
    return new Response("Not available.", { status: 403 });
  const db = await createSupabaseServerClient();
  const view = await loadRivals(db, state.product.id, new Date(), "all");
  const markdown = renderRivalReport({
    week: view.week,
    productName: state.product.name,
    scorecards: view.scorecards,
    fixes: view.fixes,
  });
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="askedfor-rivals-${view.week}.md"`,
      "cache-control": "no-store",
    },
  });
}

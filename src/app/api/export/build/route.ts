import { loadAppState } from "@/server/auth/app-state";
import { gateFor } from "@/server/auth/next-step";
import { getSessionUser } from "@/server/auth/session";
import { renderBuildReport } from "@/server/build/export";
import { loadBuild } from "@/server/build/load";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Build tab as Markdown (docs/PLAN.md 4.6): links only, no excerpts, quotes or handles. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const state = await loadAppState(user.id);
  if (gateFor("build", state) || !state.product)
    return new Response("Not available.", { status: 403 });
  const db = await createSupabaseServerClient();
  const view = await loadBuild(db, state.product.id, new URL(request.url).searchParams.get("week"));
  if (!view.week) return new Response("No report yet.", { status: 404 });
  const markdown = renderBuildReport({
    week: view.week,
    productName: state.product.name,
    groups: view.groups,
  });
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="askedfor-build-${view.week}.md"`,
      "cache-control": "no-store",
    },
  });
}

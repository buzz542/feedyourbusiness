import { buildExport } from "@/server/account/export";
import { loadAppState } from "@/server/auth/app-state";
import { getSessionUser } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the signed-in user owns, as JSON (docs/PLAN.md 10.7), read with their own client so
 * row-level security limits it to their rows. Posts as links and labels, never excerpts.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const state = await loadAppState(user.id);
  const db = await createSupabaseServerClient();
  const productId = state.product?.id ?? "00000000-0000-0000-0000-000000000000";
  const [profile, product, competitors, terms, feed, themes, insights] = await Promise.all([
    db
      .from("profiles")
      .select(
        "created_at, terms_accepted_at, email_daily, email_weekly, subscription_status, trial_end, current_period_end",
      )
      .eq("id", user.id)
      .maybeSingle(),
    db.from("products").select("*").eq("id", productId).maybeSingle(),
    db.from("competitors").select("*").eq("product_id", productId),
    db.from("search_terms").select("*").eq("product_id", productId),
    db
      .from("product_posts")
      .select(
        "category, relevance, reason, state, created_at, posts(url, source, community, posted_at)",
      )
      .eq("product_id", productId),
    db.from("themes").select("*").eq("product_id", productId),
    db.from("rival_insights").select("*, competitors(name)").eq("product_id", productId),
  ]);
  const failed = [profile, product, competitors, terms, feed, themes, insights].some(
    (r) => r.error,
  );
  if (failed) return new Response("Export failed. Try again.", { status: 500 });
  const p = profile.data;
  const body = buildExport(
    {
      account: {
        email: user.email,
        createdAt: p?.created_at ?? null,
        termsAcceptedAt: p?.terms_accepted_at ?? null,
        emailDaily: p?.email_daily ?? true,
        emailWeekly: p?.email_weekly ?? true,
        subscriptionStatus: p?.subscription_status ?? null,
        trialEnd: p?.trial_end ?? null,
        currentPeriodEnd: p?.current_period_end ?? null,
      },
      product: product.data,
      competitors: competitors.data ?? [],
      terms: terms.data ?? [],
      feed: (feed.data ?? []).map((f) => {
        const post = Array.isArray(f.posts) ? f.posts[0] : f.posts;
        return { ...post, ...f, linked_at: f.created_at };
      }),
      themes: themes.data ?? [],
      rivalInsights: (insights.data ?? []).map((r) => {
        const c = Array.isArray(r.competitors) ? r.competitors[0] : r.competitors;
        return { ...r, rival: c?.name ?? r.tool_name };
      }),
    },
    new Date(),
  );
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="askedfor-export.json"`,
      "cache-control": "no-store",
    },
  });
}

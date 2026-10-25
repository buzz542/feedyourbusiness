import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toCard, type FeedCard } from "@/server/reply/feed";
import { weekOf } from "@/server/synthesis/checks";
import type { Database } from "@/types/database";
import { buildScorecards, earlierWeeks, rivalKeyOf, type Scorecard } from "./view";

type UserClient = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Evidence {
  id: string;
  url: string;
  source: string;
  community: string | null;
}

export interface RivalsView {
  week: string;
  pick: string;
  competitors: { id: string; name: string }[];
  scorecards: Scorecard[];
  switchers: FeedCard[];
  fixes: { title: string; summary: string; evidence: Evidence[] }[];
  discovered: { name: string; mentions: number }[];
}

/** The picker value from the URL: "all", "discovered" or one of the product's competitor ids. */
export function parsePick(raw: unknown, competitorIds: readonly string[]): string {
  if (raw === "discovered") return "discovered";
  if (typeof raw === "string" && UUID.test(raw) && competitorIds.includes(raw.toLowerCase()))
    return `c:${raw.toLowerCase()}`;
  return "all";
}

/** Everything the Rivals tab shows, with the user's client: row-level security applies. */
export async function loadRivals(
  db: UserClient,
  productId: string,
  now: Date,
  rawPick: unknown,
): Promise<RivalsView> {
  const week = weekOf(now);
  const since = new Date(`${week}T00:00:00Z`);
  const competitors =
    (await db.from("competitors").select("id, name").eq("product_id", productId).order("name"))
      .data ?? [];
  const pick = parsePick(
    rawPick,
    competitors.map((c) => c.id),
  );
  const competitorId = pick.startsWith("c:") ? pick.slice(2) : null;
  const first = earlierWeeks(week)[0]!;

  const [counts, insights, switchers, fixes, discovered] = await Promise.all([
    db.rpc("rival_counts", {
      p_product: productId,
      p_since: since.toISOString(),
      p_until: now.toISOString(),
    }),
    db
      .from("rival_insights")
      .select("week, competitor_id, tool_name, issue, complaints, switching, summary")
      .eq("product_id", productId)
      .gte("week", first)
      .lte("week", week),
    db.rpc("rival_switchers", {
      p_product: productId,
      ...(competitorId ? { p_competitor: competitorId } : {}),
      p_limit: 20,
    }),
    db
      .from("themes")
      .select("week, title, summary, example_post_ids")
      .eq("product_id", productId)
      .eq("kind", "rival_fix")
      .lte("week", week)
      .order("week", { ascending: false })
      .limit(3),
    db.rpc("discovered_tools", {
      p_product: productId,
      p_since: new Date(now.getTime() - 28 * 86_400_000).toISOString(),
      p_until: now.toISOString(),
    }),
  ]);
  if (counts.error || insights.error || switchers.error || fixes.error || discovered.error)
    throw new Error("Supabase: could not load the Rivals tab");

  const names = new Map(
    competitors.map((c) => [rivalKeyOf({ competitorId: c.id, toolName: null }), c.name]),
  );
  const scorecards = buildScorecards({
    week,
    thisWeek: (counts.data ?? []).map((r) => ({
      competitorId: r.competitor_id,
      toolName: r.tool_name,
      issue: r.issue,
      complaints: r.complaints,
      switching: r.switching,
    })),
    insights: (insights.data ?? []).map((r) => ({
      week: r.week,
      competitorId: r.competitor_id,
      toolName: r.tool_name,
      issue: r.issue,
      complaints: r.complaints,
      switching: r.switching,
      summary: r.summary,
    })),
    names,
    pick,
  });

  // Fixes from the newest synthesized week, with evidence posts while they are still stored.
  const newest = fixes.data?.[0]?.week;
  const fixRows = (fixes.data ?? []).filter((f) => f.week === newest);
  const ids = [...new Set(fixRows.flatMap((f) => f.example_post_ids))];
  const posts = ids.length
    ? ((await db.from("posts").select("id, url, source, community").in("id", ids)).data ?? [])
    : [];
  const byId = new Map(posts.map((p) => [p.id, p]));

  return {
    week,
    pick,
    competitors,
    scorecards,
    switchers: (switchers.data ?? []).map(toCard).filter((c): c is FeedCard => c !== null),
    fixes: fixRows.map((f) => ({
      title: f.title,
      summary: f.summary,
      evidence: f.example_post_ids.flatMap((id) => {
        const p = byId.get(id);
        return p && /^https:\/\//.test(p.url) ? [p] : [];
      }),
    })),
    discovered: (discovered.data ?? []).map((d) => ({ name: d.tool_name, mentions: d.mentions })),
  };
}

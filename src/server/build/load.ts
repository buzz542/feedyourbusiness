import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Evidence } from "@/server/rivals/load";
import { groupThemes, type BuildTheme, type BuildView } from "./view";

type UserClient = SupabaseClient<Database>;

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

/** The Build tab for one week (the newest by default), with the user's client: RLS applies. */
export async function loadBuild(
  db: UserClient,
  productId: string,
  rawWeek: unknown,
): Promise<BuildView> {
  const weeksQuery = await db
    .from("themes")
    .select("week")
    .eq("product_id", productId)
    .order("week", { ascending: false })
    .limit(500);
  if (weeksQuery.error) throw new Error("Supabase: could not load weeks");
  const weeks = [...new Set((weeksQuery.data ?? []).map((r) => r.week))].slice(0, 26);
  const week =
    typeof rawWeek === "string" && WEEK.test(rawWeek) && weeks.includes(rawWeek)
      ? rawWeek
      : (weeks[0] ?? null);
  if (!week) return { week: null, weeks, groups: groupThemes([]) };

  const rows = await db
    .from("themes")
    .select("id, kind, theme_key, title, summary, count, trend, example_post_ids")
    .eq("product_id", productId)
    .eq("week", week)
    .order("count", { ascending: false });
  if (rows.error) throw new Error("Supabase: could not load themes");
  const ids = [...new Set((rows.data ?? []).flatMap((r) => r.example_post_ids))];
  const posts = ids.length
    ? ((await db.from("posts").select("id, url, source, community").in("id", ids)).data ?? [])
    : [];
  const byId = new Map<string, Evidence>(posts.map((p) => [p.id, p]));
  const themes: BuildTheme[] = (rows.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as BuildTheme["kind"],
    themeKey: r.theme_key,
    title: r.title,
    summary: r.summary,
    count: r.count,
    trend: r.trend as BuildTheme["trend"],
    evidence: r.example_post_ids.flatMap((id) => {
      const p = byId.get(id);
      return p && /^https:\/\//.test(p.url) ? [p] : [];
    }),
  }));
  return { week, weeks, groups: groupThemes(themes) };
}

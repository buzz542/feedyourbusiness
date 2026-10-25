import "server-only";
import { ISSUES, type Issue } from "@/server/classify/schema";
import type { AdminClient } from "@/server/supabase/admin";
import type { SynthesisStore, WeekPost } from "./synthesize";

/** Supabase adapter for the weekly synthesis (service role; expired posts are excluded). */

const isIssue = (s: string | null): s is Issue =>
  s !== null && (ISSUES as readonly string[]).includes(s);
const SENTIMENTS = ["negative", "mixed", "positive"] as const;

export function createSupabaseSynthesisStore(db: AdminClient): SynthesisStore {
  const must = <T>(r: { data: T; error: unknown }, what: string): T => {
    if (r.error) throw new Error(`Supabase: ${what}`);
    return r.data;
  };
  return {
    async product(productId) {
      const [product, competitors] = await Promise.all([
        db.from("products").select("name, one_liner").eq("id", productId).maybeSingle(),
        db.from("competitors").select("id, name").eq("product_id", productId).order("name"),
      ]);
      const p = must(product, "could not load the product");
      if (!p) return null;
      return {
        name: p.name,
        oneLiner: p.one_liner,
        competitors: must(competitors, "could not load competitors") ?? [],
      };
    },
    async weekPosts(productId, since, until, limit) {
      const rows =
        must(
          await db
            .from("product_posts")
            .select(
              "post_id, category, competitor_id, tool_mentioned, rival_issue, rival_sentiment, switching, relevance, posts!inner(excerpt, delete_after)",
            )
            .eq("product_id", productId)
            .gte("created_at", since.toISOString())
            .lt("created_at", until.toISOString())
            .gt("posts.delete_after", until.toISOString())
            .order("relevance", { ascending: false })
            .limit(limit),
          "could not load the week's posts",
        ) ?? [];
      return rows.flatMap((r): WeekPost[] => {
        const post = Array.isArray(r.posts) ? r.posts[0] : r.posts;
        if (!post) return [];
        const sentiment = SENTIMENTS.find((s) => s === r.rival_sentiment);
        return [
          {
            id: r.post_id,
            category: r.category,
            excerpt: post.excerpt,
            competitorId: r.competitor_id,
            toolMentioned: r.tool_mentioned,
            rival:
              isIssue(r.rival_issue) && sentiment
                ? { issue: r.rival_issue, sentiment, switching: r.switching }
                : null,
          },
        ];
      });
    },
    async lastThemes(productId, week) {
      const rows =
        must(
          await db
            .from("themes")
            .select("kind, theme_key, count")
            .eq("product_id", productId)
            .eq("week", week),
          "could not load last week's themes",
        ) ?? [];
      return rows.map((r) => ({ kind: r.kind, themeKey: r.theme_key, count: r.count }));
    },
    async lastRivals(productId, week) {
      const rows =
        must(
          await db
            .from("rival_insights")
            .select("competitor_id, tool_name, issue, complaints")
            .eq("product_id", productId)
            .eq("week", week),
          "could not load last week's rivals",
        ) ?? [];
      return rows.map((r) => ({
        competitorId: r.competitor_id,
        toolName: r.tool_name,
        issue: r.issue,
        complaints: r.complaints,
      }));
    },
    async saveThemes(productId, week, rows) {
      must(
        await db.from("themes").delete().eq("product_id", productId).eq("week", week),
        "could not clear the week's themes",
      );
      if (rows.length === 0) return;
      // Titles are unique per product and week; a repeat title gets its kind appended.
      const titles = new Set<string>();
      must(
        await db.from("themes").insert(
          rows.map((r) => {
            let title = r.title.slice(0, 160);
            if (titles.has(title)) title = `${title} (${r.kind})`.slice(0, 160);
            titles.add(title);
            return {
              product_id: productId,
              week,
              kind: r.kind,
              theme_key: r.themeKey,
              title,
              summary: r.summary.slice(0, 1000),
              count: r.count,
              trend: r.trend,
              example_post_ids: r.examplePostIds,
            };
          }),
        ),
        "could not save themes",
      );
    },
    async saveRivals(productId, week, rows) {
      must(
        await db.from("rival_insights").delete().eq("product_id", productId).eq("week", week),
        "could not clear the week's rival insights",
      );
      if (rows.length === 0) return;
      must(
        await db.from("rival_insights").insert(
          rows.map((r) => ({
            product_id: productId,
            week,
            competitor_id: r.competitorId,
            tool_name: r.toolName?.slice(0, 60) ?? null,
            issue: r.issue,
            complaints: r.complaints,
            switching: r.switching,
            trend: r.trend,
            summary: r.summary.slice(0, 600),
            example_post_ids: r.examplePostIds,
          })),
        ),
        "could not save rival insights",
      );
    },
  };
}

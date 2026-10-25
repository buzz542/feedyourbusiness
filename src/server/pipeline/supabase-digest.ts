import "server-only";
import { FEED_CATEGORIES, type FeedCategory } from "@/lib/reply-filters";
import type { AdminClient } from "@/server/supabase/admin";
import { weekOf } from "@/server/synthesis/checks";
import type {
  DailyDigestDeps,
  DigestCard,
  DigestRecipient,
  WeeklyDigestDeps,
  WeeklySummary,
} from "./digest";
import { claimJobEmail, optionalMailer } from "./supabase-first-run";

/** Supabase adapters for the digests (service role; reads exclude posts past delete_after). */

export async function digestRecipient(
  db: AdminClient,
  productId: string,
): Promise<DigestRecipient | null> {
  const product = await db.from("products").select("owner_id").eq("id", productId).maybeSingle();
  if (product.error) throw new Error("Supabase: could not load the product");
  if (!product.data) return null;
  const userId = product.data.owner_id;
  const [profile, user] = await Promise.all([
    db.from("profiles").select("email_daily, email_weekly").eq("id", userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
  ]);
  if (profile.error || user.error) throw new Error("Supabase: could not load the recipient");
  const email = user.data.user?.email;
  if (!profile.data || !email) return null;
  return {
    userId,
    email,
    daily: profile.data.email_daily,
    weekly: profile.data.email_weekly,
  };
}

const isCategory = (c: string): c is FeedCategory =>
  (FEED_CATEGORIES as readonly string[]).includes(c);

export function createSupabaseDailyDigestDeps(db: AdminClient): DailyDigestDeps {
  return {
    recipient: (productId) => digestRecipient(db, productId),
    async newCards(productId, since, until, limit) {
      const { data, error } = await db
        .from("product_posts")
        .select(
          "id, category, reason, relevance, created_at, posts!inner(source, community, posted_at, delete_after)",
        )
        .eq("product_id", productId)
        .eq("state", "new")
        .gte("created_at", since.toISOString())
        .lt("created_at", until.toISOString())
        .gt("posts.delete_after", until.toISOString())
        .order("relevance", { ascending: false })
        .limit(limit);
      if (error) throw new Error("Supabase: could not load new cards");
      return (data ?? []).flatMap((row): DigestCard[] => {
        const post = Array.isArray(row.posts) ? row.posts[0] : row.posts;
        if (!post || !isCategory(row.category)) return [];
        return [
          {
            id: row.id,
            source: post.source,
            community: post.community,
            category: row.category,
            reason: row.reason,
            postedAt: new Date(post.posted_at),
          },
        ];
      });
    },
    claim: (jobId) => claimJobEmail(db, jobId),
    mailer: optionalMailer,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    secret: process.env.APP_HMAC_SECRET,
  };
}

type Trend = WeeklySummary["themes"][number]["trend"];
const TRENDS = ["new", "up", "down", "flat"] as const;
const asTrend = (t: string): Trend => TRENDS.find((x) => x === t) ?? "flat";

/** The newest synthesized week on or before `before`: themes, rival totals, what to build next. */
export async function weeklySummary(
  db: AdminClient,
  productId: string,
  before: Date,
): Promise<WeeklySummary | null> {
  const latest = await db
    .from("themes")
    .select("week")
    .eq("product_id", productId)
    .lte("week", weekOf(before))
    .order("week", { ascending: false })
    .limit(1);
  const rivalsLatest = await db
    .from("rival_insights")
    .select("week")
    .eq("product_id", productId)
    .lte("week", weekOf(before))
    .order("week", { ascending: false })
    .limit(1);
  if (latest.error || rivalsLatest.error) throw new Error("Supabase: could not load the week");
  const week = [latest.data?.[0]?.week, rivalsLatest.data?.[0]?.week].filter(Boolean).sort().pop();
  if (!week) return null;
  const [themes, rivals, competitors] = await Promise.all([
    db
      .from("themes")
      .select("kind, title, summary, count, trend")
      .eq("product_id", productId)
      .eq("week", week)
      .order("count", { ascending: false }),
    db
      .from("rival_insights")
      .select("competitor_id, tool_name, complaints, trend")
      .eq("product_id", productId)
      .eq("week", week),
    db.from("competitors").select("id, name").eq("product_id", productId),
  ]);
  if (themes.error || rivals.error || competitors.error)
    throw new Error("Supabase: could not load the weekly summary");
  const names = new Map((competitors.data ?? []).map((c) => [c.id, c.name]));
  const totals = new Map<string, { name: string; complaints: number; trend: Trend }>();
  for (const r of rivals.data ?? []) {
    const name = (r.competitor_id ? names.get(r.competitor_id) : r.tool_name) ?? "";
    if (!name) continue;
    const current = totals.get(name.toLowerCase()) ?? {
      name,
      complaints: 0,
      trend: asTrend(r.trend),
    };
    current.complaints += r.complaints;
    if (r.trend === "up") current.trend = "up";
    totals.set(name.toLowerCase(), current);
  }
  const rows = themes.data ?? [];
  return {
    week,
    themes: rows
      .filter((t) => t.kind === "ask" || t.kind === "wish" || t.kind === "pain")
      .map((t) => ({ title: t.title, count: t.count, trend: asTrend(t.trend) })),
    rivals: [...totals.values()]
      .filter((r) => r.complaints > 0)
      .sort((a, b) => b.complaints - a.complaints),
    next: rows
      .filter((t) => t.kind === "opportunity" || t.kind === "rival_fix")
      .map((t) => ({ title: t.title, summary: t.summary })),
  };
}

export function createSupabaseWeeklyDigestDeps(db: AdminClient): WeeklyDigestDeps {
  return {
    recipient: (productId) => digestRecipient(db, productId),
    summary: (productId, before) => weeklySummary(db, productId, before),
    claim: (jobId) => claimJobEmail(db, jobId),
    mailer: optionalMailer,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    secret: process.env.APP_HMAC_SECRET,
  };
}

import "server-only";
import { FEED_CATEGORIES, type FeedCategory } from "@/lib/reply-filters";
import type { AdminClient } from "@/server/supabase/admin";
import type { DailyDigestDeps, DigestCard, DigestRecipient } from "./digest";
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

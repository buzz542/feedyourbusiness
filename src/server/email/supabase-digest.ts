import "server-only";
import { isEntitled } from "@/server/billing/subscription";
import type { FeedCategory } from "@/server/store/feed";
import type { AdminClient } from "@/server/supabase/admin";
import type { DigestStore } from "./digest";

class DigestStoreError extends Error {
  override name = "DigestStoreError";
}

const must = <T>(r: { data: T; error: { code?: string } | null }): T => {
  if (r.error) throw new DigestStoreError(r.error.code ?? "unknown");
  return r.data;
};

/** The digest's reads through the service role: links and labels only, never an excerpt. */
export function createSupabaseDigestStore(admin: AdminClient): DigestStore {
  return {
    async recipient(productId) {
      const product = must(
        await admin.from("products").select("owner_id").eq("id", productId).maybeSingle(),
      );
      if (!product) return null;
      const profile = must(
        await admin
          .from("profiles")
          .select("email_daily, subscription_status")
          .eq("id", product.owner_id)
          .maybeSingle(),
      );
      const { data, error } = await admin.auth.admin.getUserById(product.owner_id);
      if (error) throw new DigestStoreError("owner lookup failed");
      return {
        userId: product.owner_id,
        email: data.user?.email ?? null,
        daily: profile?.email_daily ?? false,
        entitled: isEntitled(profile?.subscription_status ?? null),
      };
    },
    async newPosts(productId, since, limit) {
      const rows = must(
        await admin
          .from("feed_items")
          .select("id, source, community, posted_at, category, reason")
          .eq("product_id", productId)
          .eq("state", "new")
          .gte("created_at", since.toISOString())
          .order("relevance", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(limit),
      );
      return (rows ?? []).map((r) => ({
        id: r.id,
        source: r.source,
        community: r.community,
        postedAt: r.posted_at,
        category: r.category as FeedCategory,
        reason: r.reason,
      }));
    },
    async categoryCounts(productId) {
      const rows = must(
        await admin
          .from("feed_items")
          .select("category")
          .eq("product_id", productId)
          .neq("state", "hidden")
          .limit(1000),
      );
      const counts = new Map<FeedCategory, number>();
      for (const r of rows ?? [])
        counts.set(r.category as FeedCategory, (counts.get(r.category as FeedCategory) ?? 0) + 1);
      return [...counts].map(([category, count]) => ({ category, count }));
    },
    async firstRunPending(productId) {
      const rows = must(
        await admin
          .from("jobs")
          .select("id")
          .eq("kind", "first_run")
          .eq("product_id", productId)
          .in("status", ["queued", "running", "waiting"])
          .limit(1),
      );
      return (rows ?? []).length > 0;
    },
  };
}

/** First-run progress by source for one product (jobs are invisible to customers). */
export async function firstRunProgress(admin: AdminClient, productId: string) {
  const rows = must(
    await admin
      .from("jobs")
      .select("source, status")
      .eq("kind", "first_run")
      .eq("product_id", productId)
      .order("source"),
  );
  return (rows ?? []).map((r) => ({
    source: r.source ?? "",
    status: r.status as "queued" | "running" | "waiting" | "done" | "failed",
  }));
}

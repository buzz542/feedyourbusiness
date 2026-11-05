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
  // The product's own minimum match, as the Reply tab uses by default.
  const thresholdOf = async (productId: string) =>
    must(
      await admin.from("products").select("relevance_threshold").eq("id", productId).maybeSingle(),
    )?.relevance_threshold ?? 60;
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
      const threshold = await thresholdOf(productId);
      // The service role bypasses RLS: retention is filtered here explicitly (2.3.4).
      const rows = must(
        await admin
          .from("product_posts")
          .select("id, category, reason, posts!inner(source, community, posted_at)")
          .eq("product_id", productId)
          .eq("state", "new")
          .gte("relevance", threshold)
          .gte("created_at", since.toISOString())
          .gt("posts.delete_after", new Date().toISOString())
          .order("relevance", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(limit),
      );
      return (rows ?? []).flatMap((r) => {
        const post = Array.isArray(r.posts) ? r.posts[0] : r.posts;
        return post
          ? [
              {
                id: r.id,
                source: post.source,
                community: post.community,
                postedAt: post.posted_at,
                category: r.category as FeedCategory,
                reason: r.reason,
              },
            ]
          : [];
      });
    },
    async categoryCounts(productId) {
      const threshold = await thresholdOf(productId);
      const rows = must(
        await admin
          .from("product_posts")
          .select("category, posts!inner(delete_after)")
          .eq("product_id", productId)
          .neq("state", "hidden")
          .gte("relevance", threshold)
          .gt("posts.delete_after", new Date().toISOString())
          .limit(1000),
      );
      const counts = new Map<FeedCategory, number>();
      for (const r of rows ?? [])
        counts.set(r.category as FeedCategory, (counts.get(r.category as FeedCategory) ?? 0) + 1);
      return [...counts].map(([category, count]) => ({ category, count }));
    },
    /**
     * The send record is a finished jobs row keyed `sent:<job id>`, inserted only if absent: the
     * jobs table's unique dedupe key makes the claim atomic, and the purge drops it after 30 days.
     */
    async claimSend(jobId) {
      const rows = must(
        await admin
          .from("jobs")
          .upsert(
            {
              kind: "digest_daily",
              product_id: null,
              status: "done",
              dedupe_key: `sent:${jobId}`,
              payload: { send_record: true },
              finished_at: new Date().toISOString(),
            },
            { onConflict: "dedupe_key", ignoreDuplicates: true },
          )
          .select("id"),
      );
      return (rows ?? []).length > 0;
    },
    async releaseSend(jobId) {
      must(await admin.from("jobs").delete().eq("dedupe_key", `sent:${jobId}`));
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

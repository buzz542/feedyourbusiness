import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { CollectStore } from "./collect-step";
import type { DeletionStore } from "./deletion-sync";

class CollectStoreError extends Error {
  override name = "CollectStoreError";
}

/** Errors carry the Postgres code only (2.3.10). */
const fail = (error: { code?: string } | null) => {
  if (error) throw new CollectStoreError(`Supabase error ${error.code ?? "unknown"}`);
};

/** `.in()` lists go in the query string: chunks of 50 keep each URL well under gateway limits. */
const CHUNK = 50;
const chunks = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/**
 * The collect step's store through the service role (docs/PLAN.md 7.3). Posts go in only through
 * ingest_post, which checks the suppression list in the same statement; links use on conflict do
 * nothing. The label columns beyond relevance, category and reason (highlight, rival, term) arrive
 * with the classification migration (M4, 6.4), and this adapter writes them from then on.
 */
export function createSupabaseCollectStore(admin: AdminClient): CollectStore {
  return {
    async suppressed(source, hashes) {
      const found = new Set<string>();
      for (const part of chunks(hashes)) {
        const { data, error } = await admin
          .from("suppression")
          .select("author_hash")
          .eq("source", source)
          .in("author_hash", part);
        fail(error);
        for (const r of data ?? []) found.add(r.author_hash);
      }
      return found;
    },

    async linked(productId, source, externalIds) {
      const found = new Set<string>();
      for (const part of chunks(externalIds)) {
        const { data, error } = await admin
          .from("product_posts")
          .select("posts!inner(external_id, source)")
          .eq("product_id", productId)
          .eq("posts.source", source)
          .in("posts.external_id", part);
        fail(error);
        for (const row of data ?? []) {
          const post = (row as { posts: { external_id: string } | { external_id: string }[] })
            .posts;
          for (const p of Array.isArray(post) ? post : [post]) found.add(p.external_id);
        }
      }
      return found;
    },

    async ingest(post, now) {
      const { data, error } = await admin.rpc("ingest_post", {
        p_source: post.source,
        p_external_id: post.externalId,
        p_url: post.url,
        p_excerpt: post.excerpt,
        p_posted_at: post.postedAt.toISOString(),
        p_author_hash: post.authorHash,
        p_community: post.community,
        p_now: now.toISOString(),
      });
      fail(error);
      return typeof data === "string" ? data : null;
    },

    async link(productId, postId, label) {
      const { error } = await admin.from("product_posts").upsert(
        {
          product_id: productId,
          post_id: postId,
          relevance: label.relevance,
          category: label.category,
          reason: label.reason,
        },
        { onConflict: "product_id,post_id", ignoreDuplicates: true },
      );
      fail(error);
    },

    async recordTermStats(jobId, day, source, stats) {
      const { error } = await admin.rpc("record_term_stats", {
        p_job_id: jobId,
        p_day: day,
        p_source: source,
        p_stats: stats.map((s) => ({
          term_id: s.termId,
          fetched: s.fetched,
          relevant: s.relevant,
        })),
      });
      fail(error);
    },
  };
}

/** Owner emails for the pre-launch allowlist filter (12.10), through the auth admin API. */
export function createOwnerEmailLookup(admin: AdminClient) {
  return async (ownerId: string): Promise<string | null> => {
    const { data, error } = await admin.auth.admin.getUserById(ownerId);
    if (error) throw new CollectStoreError("owner lookup failed");
    return data.user?.email ?? null;
  };
}

/** Deletion sync's store (docs/PLAN.md 2.3.6): stored posts by source, removals, re-checks due. */
export function createSupabaseDeletionStore(admin: AdminClient): DeletionStore {
  return {
    async stored(source, afterId, limit, now) {
      let query = admin
        .from("posts")
        .select("id, external_id")
        .eq("source", source)
        .gt("delete_after", now.toISOString())
        .order("id")
        .limit(limit);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      fail(error);
      return (data ?? []).map((r) => ({ id: r.id, externalId: r.external_id }));
    },

    async remove(source, externalIds) {
      if (externalIds.length === 0) return 0;
      const { data, error } = await admin.rpc("delete_posts_at_source", {
        p_source: source,
        p_external_ids: [...externalIds],
      });
      fail(error);
      return typeof data === "number" ? data : 0;
    },

    async recheckDue(productId, from, to, limit) {
      const { data, error } = await admin.rpc("reddit_recheck_posts", {
        p_product_id: productId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_limit: limit,
      });
      fail(error);
      return (data ?? []).map((r) => ({ externalId: r.external_id, url: r.url }));
    },
  };
}

/** Products with Reddit posts due for their one-time re-check (reddit_recheck_products). */
export async function recheckProducts(admin: AdminClient, from: Date, to: Date): Promise<string[]> {
  const { data, error } = await admin.rpc("reddit_recheck_products", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  fail(error);
  return (data ?? []).map((r) => r.id);
}

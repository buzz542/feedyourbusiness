import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { CollectTerm } from "@/sources/types";
import type { CollectStore } from "./collect-step";
import type { DeletionStore } from "./deletion-sync";

/** Supabase implementation of the collect step's store (docs/PLAN.md 7.3). Service role only. */

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase: ${result.error.message}`);
  return result.data;
}

/** PostgREST puts `in` lists in the URL; keep each request well under its limits. */
const CHUNK = 200;
function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export function createSupabaseCollectStore(db: AdminClient): CollectStore {
  return {
    async suppressed(source, hashes) {
      const found = new Set<string>();
      for (const part of chunks(hashes)) {
        const rows = must(
          await db
            .from("suppression")
            .select("author_hash")
            .eq("source", source)
            .in("author_hash", part),
        );
        for (const row of rows ?? []) found.add(row.author_hash);
      }
      return found;
    },

    async linked(productId, source, externalIds) {
      const found = new Set<string>();
      for (const part of chunks(externalIds)) {
        const posts = must(
          await db
            .from("posts")
            .select("id, external_id")
            .eq("source", source)
            .in("external_id", part),
        );
        if (!posts?.length) continue;
        const links = must(
          await db
            .from("product_posts")
            .select("post_id")
            .eq("product_id", productId)
            .in(
              "post_id",
              posts.map((p) => p.id),
            ),
        );
        const linkedIds = new Set((links ?? []).map((l) => l.post_id));
        for (const post of posts) if (linkedIds.has(post.id)) found.add(post.external_id);
      }
      return found;
    },

    async ingest(post, now) {
      const id = must(
        await db.rpc("ingest_post", {
          p_source: post.source,
          p_external_id: post.externalId,
          p_url: post.url,
          p_excerpt: post.excerpt,
          p_posted_at: post.postedAt.toISOString(),
          p_author_hash: post.authorHash,
          // Every source names a community; null stays null rather than becoming "".
          p_community: post.community as string,
          p_now: now.toISOString(),
        }),
      ) as string | null; // null: the author is suppressed (the generated type hides it)
      return id ?? null;
    },

    async link(productId, postId, label) {
      must(
        await db.from("product_posts").upsert(
          {
            product_id: productId,
            post_id: postId,
            relevance: label.relevance,
            category: label.category,
            reason: label.reason,
          },
          { onConflict: "product_id,post_id", ignoreDuplicates: true },
        ),
      );
    },

    async recordTermStats(jobId, day, source, stats) {
      must(
        await db.rpc("record_term_stats", {
          p_job_id: jobId,
          p_day: day,
          p_source: source,
          p_stats: stats.map((s) => ({
            term_id: s.termId,
            fetched: s.fetched,
            relevant: s.relevant,
          })),
        }),
      );
    },
  };
}

/**
 * Step 1 of 7.3 at run time: null when the product is no longer collectable (paused, unconfirmed,
 * or its owner no longer entitled), otherwise its active, unpaused terms.
 */
export async function loadCollectTerms(
  db: AdminClient,
  productId: string,
): Promise<CollectTerm[] | null> {
  const collectable = must(await db.rpc("collectable_products").eq("id", productId));
  if (!collectable?.length) return null;
  const terms = must(
    await db
      .from("search_terms")
      .select("id, term")
      .eq("product_id", productId)
      .eq("active", true)
      .eq("paused", false)
      .order("created_at")
      .order("id"),
  );
  return (terms ?? []).map((t) => ({ id: t.id, term: t.term }));
}

/** Supabase implementation of the deletion sync's store. Service role only. */
export function createSupabaseDeletionStore(db: AdminClient): DeletionStore {
  return {
    async stored(source, afterId, limit, now) {
      let query = db
        .from("posts")
        .select("id, external_id")
        .eq("source", source)
        .gt("delete_after", now.toISOString());
      if (afterId) query = query.gt("id", afterId);
      const rows = must(await query.order("id").limit(limit));
      return (rows ?? []).map((r) => ({ id: r.id, externalId: r.external_id }));
    },

    async remove(source, externalIds) {
      let removed = 0;
      for (const part of chunks(externalIds)) {
        const { count, error } = await db
          .from("posts")
          .delete({ count: "exact" })
          .eq("source", source)
          .in("external_id", part);
        if (error) throw new Error(`Supabase: ${error.message}`);
        removed += count ?? 0;
      }
      return removed;
    },

    async recheckDue(productId, from, to, limit) {
      const rows = must(
        await db.rpc("reddit_recheck_posts", {
          p_product_id: productId,
          p_from: from.toISOString(),
          p_to: to.toISOString(),
          p_limit: limit,
        }),
      );
      return (rows ?? []).map((r) => ({ externalId: r.external_id, url: r.url }));
    },
  };
}

/** Products with Reddit posts due for their deletion re-check (reddit_recheck_products). */
export async function recheckProducts(db: AdminClient, from: Date, to: Date): Promise<string[]> {
  const rows = must(
    await db.rpc("reddit_recheck_products", { p_from: from.toISOString(), p_to: to.toISOString() }),
  );
  return (rows ?? []).map((r) => r.id);
}

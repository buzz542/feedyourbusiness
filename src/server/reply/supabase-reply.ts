import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { POST_STATES, type PostState, type PostStateStore } from "./post-actions";

type UserClient = SupabaseClient<Database>;

/** What the Reply page needs about the product, read with the user's client (RLS applies). */
export interface ReplyContext {
  threshold: number;
  subreddits: string[];
  rivals: { id: string; name: string }[];
  terms: string[];
}

export async function loadReplyContext(db: UserClient, productId: string): Promise<ReplyContext> {
  const [product, rivals, terms] = await Promise.all([
    db.from("products").select("relevance_threshold, subreddits").eq("id", productId).maybeSingle(),
    db.from("competitors").select("id, name").eq("product_id", productId).order("name"),
    db
      .from("search_terms")
      .select("term")
      .eq("product_id", productId)
      .eq("active", true)
      .eq("paused", false)
      .order("created_at"),
  ]);
  if (product.error || rivals.error || terms.error)
    throw new Error("Supabase: could not load the Reply context");
  return {
    threshold: product.data?.relevance_threshold ?? 60,
    subreddits: product.data?.subreddits ?? [],
    rivals: rivals.data ?? [],
    terms: (terms.data ?? []).map((t) => t.term),
  };
}

const isState = (s: string): s is PostState => (POST_STATES as readonly string[]).includes(s);

/** Changes only `state` (the column grant allows nothing else), on the user's own cards. */
export function createPostStateStore(db: UserClient): PostStateStore {
  return {
    async setState(id, to) {
      const current = await db
        .from("product_posts")
        .select("state, category, relevance, posts(source)")
        .eq("id", id)
        .maybeSingle();
      if (current.error) throw new Error("Supabase: could not read the card");
      if (!current.data || !isState(current.data.state)) return null;
      const updated = await db
        .from("product_posts")
        .update({ state: to })
        .eq("id", id)
        .select("id");
      if (updated.error) throw new Error("Supabase: could not update the card");
      if ((updated.data ?? []).length === 0) return null;
      const post = current.data.posts as { source: string } | { source: string }[] | null;
      const source = (Array.isArray(post) ? post[0]?.source : post?.source) ?? "hackernews";
      return {
        from: current.data.state,
        source,
        category: current.data.category,
        relevance: current.data.relevance,
      };
    },
  };
}

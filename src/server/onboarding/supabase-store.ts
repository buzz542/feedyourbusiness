import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CompetitorOrigin, OnboardingStore, TermIntent } from "./ports";

class OnboardingStoreError extends Error {
  override name = "OnboardingStoreError";
  constructor(readonly code: string | undefined) {
    super(`Onboarding store error ${code ?? "unknown"}`);
  }
}

const UNIQUE_VIOLATION = "23505";

/**
 * The onboarding store on the signed-in user's own client: RLS limits every statement to the
 * user's own product, and the grants to the columns a user may write (docs/PLAN.md 5.2).
 */
export function createSupabaseOnboardingStore(supabase: SupabaseClient<Database>): OnboardingStore {
  const check = (error: { code?: string } | null) => {
    if (error) throw new OnboardingStoreError(error.code);
  };

  return {
    async findProduct(userId) {
      const { data, error } = await supabase
        .from("products")
        .select("id, status")
        .eq("owner_id", userId)
        .maybeSingle();
      check(error);
      return data;
    },

    async createDraftProduct(userId, fields) {
      const { data, error } = await supabase
        .from("products")
        .insert({ owner_id: userId, url: fields.url, name: fields.name })
        .select("id")
        .single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      check(error);
      return data!.id;
    },

    async saveDraft(productId, url, draft) {
      // Separate statements, ordered so a failure part way leaves a draft the owner can redo.
      // The first one also proves the product is still a draft (not confirmed in another tab).
      const updated = await supabase
        .from("products")
        .update({
          url,
          name: draft.name,
          one_liner: draft.oneLiner,
          description: draft.description,
          audience: draft.audience,
          subreddits: draft.subreddits,
        })
        .eq("id", productId)
        .eq("status", "draft")
        .select("id");
      check(updated.error);
      if (!updated.data?.length) throw new OnboardingStoreError("not_a_draft");
      check((await supabase.from("search_terms").delete().eq("product_id", productId)).error);
      if (draft.terms.length > 0) {
        const terms = draft.terms.map((t) => ({
          product_id: productId,
          term: t.term,
          intent: t.intent,
        }));
        check((await supabase.from("search_terms").insert(terms)).error);
      }
      check(
        (
          await supabase
            .from("competitors")
            .delete()
            .eq("product_id", productId)
            .eq("origin", "draft")
        ).error,
      );
      // A competitor the owner added by the same name stays theirs.
      if (draft.competitors.length > 0) {
        const competitors = draft.competitors.map((c) => ({
          product_id: productId,
          name: c.name,
          domain: c.domain,
          origin: "draft",
        }));
        check(
          (
            await supabase
              .from("competitors")
              .upsert(competitors, { onConflict: "product_id,name", ignoreDuplicates: true })
          ).error,
        );
      }
    },

    async loadReview(userId) {
      const product = await supabase
        .from("products")
        .select(
          "id, status, url, name, one_liner, description, audience, relevance_threshold, subreddits",
        )
        .eq("owner_id", userId)
        .maybeSingle();
      check(product.error);
      if (!product.data) return null;
      const p = product.data;
      const [terms, competitors] = await Promise.all([
        supabase
          .from("search_terms")
          .select("term, intent")
          .eq("product_id", p.id)
          .order("created_at")
          .order("term"),
        supabase
          .from("competitors")
          .select("name, domain, aliases, origin")
          .eq("product_id", p.id)
          .order("created_at")
          .order("name"),
      ]);
      check(terms.error);
      check(competitors.error);
      return {
        id: p.id,
        status: p.status,
        url: p.url,
        name: p.name,
        oneLiner: p.one_liner ?? "",
        description: p.description ?? "",
        audience: p.audience ?? "",
        relevanceThreshold: p.relevance_threshold,
        subreddits: p.subreddits,
        // The database checks both values (search_terms.intent, competitors.origin).
        terms: (terms.data ?? []).map((t) => ({ term: t.term, intent: t.intent as TermIntent })),
        competitors: (competitors.data ?? []).map((c) => ({
          name: c.name,
          domain: c.domain,
          aliases: c.aliases,
          origin: c.origin as CompetitorOrigin,
        })),
      };
    },

    async saveReview(productId, edits) {
      // Separate statements, as in saveDraft; the first proves the product is still a draft.
      const updated = await supabase
        .from("products")
        .update({
          url: edits.url,
          name: edits.name,
          one_liner: edits.oneLiner,
          description: edits.description,
          audience: edits.audience,
          relevance_threshold: edits.relevanceThreshold,
          subreddits: edits.subreddits,
        })
        .eq("id", productId)
        .eq("status", "draft")
        .select("id");
      check(updated.error);
      if (!updated.data?.length) throw new OnboardingStoreError("not_a_draft");

      check((await supabase.from("search_terms").delete().eq("product_id", productId)).error);
      if (edits.terms.length > 0) {
        const terms = edits.terms.map((t) => ({
          product_id: productId,
          term: t.term,
          intent: t.intent,
        }));
        check((await supabase.from("search_terms").insert(terms)).error);
      }

      // Nothing is collected before confirmation, so no label points at a competitor yet and the
      // list can be replaced whole. A name that stays keeps its origin.
      const before = await supabase
        .from("competitors")
        .select("name, origin")
        .eq("product_id", productId);
      check(before.error);
      const origins = new Map((before.data ?? []).map((c) => [c.name, c.origin]));
      check((await supabase.from("competitors").delete().eq("product_id", productId)).error);
      if (edits.competitors.length > 0) {
        const competitors = edits.competitors.map((c) => ({
          product_id: productId,
          name: c.name,
          domain: c.domain,
          aliases: c.aliases,
          origin: origins.get(c.name) ?? "user",
        }));
        check((await supabase.from("competitors").insert(competitors)).error);
      }
    },

    async confirmProduct(productId, now) {
      const { data, error } = await supabase
        .from("products")
        .update({ status: "active", confirmed_at: now.toISOString() })
        .eq("id", productId)
        .eq("status", "draft")
        .select("id");
      check(error);
      return (data?.length ?? 0) > 0;
    },
  };
}

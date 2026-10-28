import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { OnboardingStore } from "./ports";

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
  };
}

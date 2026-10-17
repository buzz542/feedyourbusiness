import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ProfileStore } from "./profile";

/**
 * Supabase implementation of the ProfileStore port, with the signed-in user's client: both
 * functions run as the caller, so row-level security limits them to the user's own product.
 */
export function createSupabaseProfileStore(db: SupabaseClient<Database>): ProfileStore {
  return {
    async save(productId, profile) {
      const { error } = await db.rpc("save_product_profile", {
        p_product_id: productId,
        p_profile: {
          name: profile.name,
          one_liner: profile.one_liner,
          description: profile.description,
          audience: profile.audience,
          subreddits: profile.subreddits,
          relevance_threshold: profile.relevance_threshold,
        },
        p_terms: profile.terms,
        p_competitors: profile.competitors,
      });
      if (error) throw new Error(`Supabase: ${error.message}`);
    },

    async confirm(productId) {
      const { error } = await db.rpc("confirm_product", { p_product_id: productId });
      if (!error) return "confirmed";
      // confirm_product raises P0002 when the product is not a draft or has no active term.
      if (error.code === "P0002") return "refused";
      throw new Error(`Supabase: ${error.message}`);
    },
  };
}

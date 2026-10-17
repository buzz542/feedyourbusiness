import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DraftStore } from "./draft";

type UserClient = SupabaseClient<Database>;

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase: ${result.error.message}`);
  return result.data;
}

/**
 * Supabase implementation of the DraftStore port. It takes the signed-in user's client, so
 * row-level security limits every read and write to that user's own product (D9: one per owner).
 */
export function createSupabaseDraftStore(db: UserClient, userId: string): DraftStore {
  async function ensureDraftProduct(
    url: string,
    retried = false,
  ): Promise<{ productId: string } | "confirmed"> {
    const existing = must(
      await db
        .from("products")
        .select("id, status, confirmed_at")
        .eq("owner_id", userId)
        .maybeSingle(),
    );
    if (existing) {
      if (existing.status !== "draft" || existing.confirmed_at) return "confirmed";
      must(await db.from("products").update({ url }).eq("id", existing.id));
      return { productId: existing.id };
    }
    const inserted = await db
      .from("products")
      .insert({ owner_id: userId, url, name: new URL(url).hostname.slice(0, 120) })
      .select("id")
      .single();
    // Two tabs racing: the unique index on owner_id lets one insert win; read that one.
    if (inserted.error?.code === "23505" && !retried) return ensureDraftProduct(url, true);
    const row = must(inserted);
    if (!row) throw new Error("Supabase: the new product was not returned");
    return { productId: row.id };
  }

  return {
    ensureDraftProduct: (url) => ensureDraftProduct(url),

    async saveDraft(productId, draft) {
      must(
        await db.rpc("save_product_draft", {
          p_product_id: productId,
          p_name: draft.name,
          p_one_liner: draft.one_liner,
          p_description: draft.description,
          p_audience: draft.audience,
          p_subreddits: draft.subreddits,
          p_terms: draft.terms,
          p_competitors: draft.competitors,
        }),
      );
    },
  };
}

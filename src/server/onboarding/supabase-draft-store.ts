import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { CleanDraft, DraftStore } from "./draft";

/**
 * The onboarding draft's store (docs/PLAN.md 8.3), through the service role after the server has
 * checked the session: start_product_draft and save_product_draft, both server-only functions.
 * Errors carry the Postgres code only.
 */
export function createSupabaseDraftStore(admin: AdminClient): DraftStore {
  return {
    async startDraft(ownerId, url, name) {
      const { data, error } = await admin.rpc("start_product_draft", {
        p_owner_id: ownerId,
        p_url: url,
        p_name: name,
      });
      if (error || typeof data !== "string")
        throw new Error(`start_product_draft failed (${error?.code ?? "no id"})`);
      return data;
    },

    async saveDraft(productId, ownerId, draft: CleanDraft) {
      const { error } = await admin.rpc(
        "save_product_draft",
        draftRpcArgs(productId, ownerId, draft),
      );
      if (error) throw new Error(`save_product_draft failed (${error.code})`);
    },
  };
}

/** The JSON save_product_draft reads: the profile object and the two recordsets. */
export function draftRpcArgs(productId: string, ownerId: string, draft: CleanDraft) {
  return {
    p_product_id: productId,
    p_owner_id: ownerId,
    p_profile: draft.profile,
    p_terms: draft.terms.map((t) => ({ term: t.term, intent: t.intent })),
    p_competitors: draft.competitors.map((c) => ({
      name: c.name,
      domain: c.domain,
      aliases: c.aliases,
    })),
  };
}

"use server";

import { redirect } from "next/navigation";
import { requirePage } from "@/server/auth/app-state";
import { trackTool, type TrackToolStore } from "@/server/rivals/track-tool";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Track a discovered tool (docs/PLAN.md 4.5), with the user's own client (RLS applies). */
export async function trackToolAction(formData: FormData): Promise<void> {
  const { state } = await requirePage("rivals", "/app/rivals");
  const productId = state.product!.id;
  const db = await createSupabaseServerClient();
  const store: TrackToolStore = {
    async competitorNames(id) {
      const { data, error } = await db.from("competitors").select("name").eq("product_id", id);
      if (error) throw new Error("Supabase: could not read competitors");
      return (data ?? []).map((c) => c.name);
    },
    async termCount(id) {
      const { count, error } = await db
        .from("search_terms")
        .select("id", { count: "exact", head: true })
        .eq("product_id", id);
      if (error) throw new Error("Supabase: could not count terms");
      return count ?? 0;
    },
    async addCompetitor(id, name) {
      const { error } = await db
        .from("competitors")
        .insert({ product_id: id, name, origin: "discovered" });
      if (error) throw new Error("Supabase: could not add the competitor");
    },
    async addTerm(id, term) {
      const { error } = await db
        .from("search_terms")
        .insert({ product_id: id, term, intent: "alternative" });
      // An existing identical term is fine.
      if (error && error.code !== "23505") throw new Error("Supabase: could not add the term");
    },
  };
  const result = await trackTool(store, productId, formData.get("name"));
  redirect(
    result.ok
      ? `/app/rivals?tracked=${encodeURIComponent(String(formData.get("name")))}`
      : "/app/rivals?rival=discovered",
  );
}

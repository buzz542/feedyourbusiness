import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftView } from "@/components/app/onboarding/profile-state";
import type { Database } from "@/types/database";
import type { TermIntent } from "./draft";

const INTENTS = new Set<string>(["problem", "category", "alternative", "competitor"]);
const isIntent = (value: string): value is TermIntent => INTENTS.has(value);

/** The signed-in user's draft for the review step, read with their own client (RLS applies). */
export async function loadDraftView(
  db: SupabaseClient<Database>,
  productId: string,
): Promise<{ url: string; updatedAt: string; view: DraftView } | null> {
  const [product, terms, competitors] = await Promise.all([
    db
      .from("products")
      .select(
        "url, name, one_liner, description, audience, relevance_threshold, subreddits, updated_at",
      )
      .eq("id", productId)
      .maybeSingle(),
    // Terms saved together share created_at: the term breaks the tie, so the order holds on reload.
    db
      .from("search_terms")
      .select("term, intent")
      .eq("product_id", productId)
      .order("created_at")
      .order("term"),
    db
      .from("competitors")
      .select("id, name, domain, aliases")
      .eq("product_id", productId)
      .order("created_at")
      .order("id"),
  ]);
  if (product.error || terms.error || competitors.error)
    throw new Error("Supabase: could not load the draft");
  if (!product.data) return null;
  const p = product.data;
  return {
    url: p.url,
    updatedAt: p.updated_at,
    view: {
      name: p.name,
      one_liner: p.one_liner ?? "",
      description: p.description ?? "",
      audience: p.audience ?? "",
      relevance_threshold: p.relevance_threshold,
      subreddits: p.subreddits,
      terms: terms.data.flatMap((t) =>
        isIntent(t.intent) ? [{ term: t.term, intent: t.intent }] : [],
      ),
      competitors: competitors.data.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        aliases: c.aliases,
      })),
    },
  };
}

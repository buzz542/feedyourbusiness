import "server-only";
import type { createSupabaseServerClient } from "@/server/supabase/server";
import type { CurrentProfile, ProfilePlan } from "./profile";

/**
 * The product profile through the owner's own client: the existing column grants and RLS decide
 * what can be read and written (tests/db/product-profile.test.ts). No new migration.
 */

type UserClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

class ProductProfileError extends Error {
  override name = "ProductProfileError";
}

export interface ProductProfile extends CurrentProfile {
  id: string;
  status: string;
  name: string;
  one_liner: string | null;
  description: string | null;
  audience: string | null;
  relevance_threshold: number;
}

/** The owner's product (one per owner), its search terms and its competitors' names, or null. */
export async function loadProductProfile(
  client: UserClient,
  ownerId: string,
): Promise<ProductProfile | null> {
  const { data: product, error } = await client
    .from("products")
    .select("id, url, name, one_liner, description, audience, relevance_threshold, status")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new ProductProfileError();
  if (!product) return null;
  const [terms, competitors] = await Promise.all([
    client
      .from("search_terms")
      .select("id, term, intent")
      .eq("product_id", product.id)
      .order("created_at"),
    client.from("competitors").select("name").eq("product_id", product.id).order("created_at"),
  ]);
  if (terms.error || competitors.error) throw new ProductProfileError();
  return {
    ...product,
    terms: terms.data,
    competitors: competitors.data.map((c) => c.name),
  };
}

/**
 * Saves a confirmed product's profile, then its terms: removals before additions, so the 40-term
 * cap never blocks a swap. A draft is edited in onboarding instead, so it is never touched here.
 */
export async function saveProductProfile(
  client: UserClient,
  productId: string,
  plan: Extract<ProfilePlan, { ok: true }>,
): Promise<void> {
  const updated = await client
    .from("products")
    .update(plan.profile)
    .eq("id", productId)
    .neq("status", "draft")
    .select("id");
  if (updated.error || (updated.data ?? []).length !== 1) throw new ProductProfileError();
  if (plan.removeTermIds.length > 0) {
    const removed = await client
      .from("search_terms")
      .delete()
      .eq("product_id", productId)
      .in("id", plan.removeTermIds);
    if (removed.error) throw new ProductProfileError();
  }
  if (plan.addTerms.length > 0) {
    const added = await client
      .from("search_terms")
      .insert(plan.addTerms.map((t) => ({ product_id: productId, term: t.term, intent: t.intent })));
    if (added.error) throw new ProductProfileError();
  }
}

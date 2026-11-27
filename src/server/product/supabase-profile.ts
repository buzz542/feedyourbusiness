import "server-only";
import type { createSupabaseServerClient } from "@/server/supabase/server";
import type { Json } from "@/types/database";
import type { CurrentProfile, ProfilePlan } from "./profile";

/**
 * The product profile through the owner's own client: the column grants and RLS decide what can be
 * read and written (tests/db/product-profile.test.ts, tests/db/product-edits.test.ts).
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
 * Saves a confirmed product's profile and its terms in one transaction, as the owner
 * (apply_product_edits): a failure saves nothing, and no product is left without terms. A draft
 * is edited in onboarding instead; the function refuses it.
 */
export async function saveProductProfile(
  client: UserClient,
  productId: string,
  plan: Extract<ProfilePlan, { ok: true }>,
): Promise<void> {
  const { error } = await client.rpc("apply_product_edits", {
    p_product_id: productId,
    p_profile: plan.profile as unknown as Json,
    p_terms: plan.terms as unknown as Json,
  });
  if (error) throw new ProductProfileError();
}

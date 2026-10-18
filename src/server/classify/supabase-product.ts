import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { ClassifyProduct, ProductLoader } from "./classify";

/**
 * The product context for the classifier (docs/PLAN.md 8.2): the profile and the competitors, each
 * competitor given a short key in a stable order. The model sees the key, never the row id.
 */

interface ProductRow {
  name: string;
  one_liner: string | null;
  description: string | null;
  audience: string | null;
}

interface CompetitorRow {
  id: string;
  name: string;
  aliases: string[];
  domain: string | null;
}

export function toClassifyProduct(
  product: ProductRow,
  competitors: readonly CompetitorRow[],
): ClassifyProduct {
  return {
    name: product.name,
    oneLiner: product.one_liner ?? "",
    description: product.description ?? "",
    audience: product.audience ?? "",
    competitors: competitors.map((c, i) => ({
      key: `c${i + 1}`,
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      domain: c.domain,
    })),
  };
}

export function createSupabaseProductLoader(db: AdminClient): ProductLoader {
  return async (productId) => {
    const product = await db
      .from("products")
      .select("name, one_liner, description, audience")
      .eq("id", productId)
      .single();
    if (product.error) throw new Error(`Supabase: ${product.error.message}`);
    const competitors = await db
      .from("competitors")
      .select("id, name, aliases, domain")
      .eq("product_id", productId)
      .order("created_at")
      .order("id");
    if (competitors.error) throw new Error(`Supabase: ${competitors.error.message}`);
    return toClassifyProduct(product.data, competitors.data ?? []);
  };
}

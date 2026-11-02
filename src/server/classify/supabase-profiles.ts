import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { ProfileStore } from "./classifier";

class ProfileStoreError extends Error {
  override name = "ProfileStoreError";
}

/** The classifier's product profile and competitors through the service role (8.2). */
export function createSupabaseProfileStore(admin: AdminClient): ProfileStore {
  return {
    async profile(productId) {
      const product = await admin
        .from("products")
        .select("name, one_liner, description, audience")
        .eq("id", productId)
        .maybeSingle();
      if (product.error) throw new ProfileStoreError(`Supabase error ${product.error.code}`);
      if (!product.data) return null;
      const competitors = await admin
        .from("competitors")
        .select("id, name, aliases")
        .eq("product_id", productId)
        .order("created_at")
        .order("id")
        .limit(20);
      if (competitors.error)
        throw new ProfileStoreError(`Supabase error ${competitors.error.code}`);
      const p = product.data;
      return {
        name: p.name,
        oneLiner: p.one_liner,
        description: p.description,
        audience: p.audience,
        aliases: [],
        competitors: (competitors.data ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          aliases: c.aliases ?? [],
        })),
      };
    },
  };
}

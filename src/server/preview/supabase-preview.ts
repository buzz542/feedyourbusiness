import "server-only";
import type { Json } from "@/types/database";
import type { AdminClient } from "@/server/supabase/admin";
import type { PreviewDeps } from "./preview";

/** preview_runs through the service role only: the table is deny-all for API roles. */
export function createSupabasePreviewStore(db: AdminClient): PreviewDeps["store"] {
  const count = async (since: Date, ipHash?: string) => {
    let query = db
      .from("preview_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString());
    if (ipHash) query = query.eq("ip_hash", ipHash);
    const { count: n, error } = await query;
    if (error) throw new Error("preview_count_failed");
    return n ?? 0;
  };
  return {
    countIp: (ipHash, since) => count(since, ipHash),
    countAll: (since) => count(since),
    async start({ ipHash, urlHost }) {
      const { data, error } = await db
        .from("preview_runs")
        .insert({ ip_hash: ipHash, url_host: urlHost.slice(0, 253), result: {} })
        .select("id")
        .single();
      if (error || !data) throw new Error("preview_start_failed");
      return data.id;
    },
    async finish(id, result) {
      const { error } = await db
        .from("preview_runs")
        .update({ result: result as unknown as Json })
        .eq("id", id);
      if (error) throw new Error("preview_save_failed");
    },
  };
}

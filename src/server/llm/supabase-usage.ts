import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { UsageStore } from "./ports";

class UsageStoreError extends Error {
  override name = "UsageStoreError";
  constructor(readonly code: string | undefined) {
    super("Could not read or write model usage");
  }
}

/** llm_usage is deny-all for API roles, so it is written and summed with the service role. */
export function createSupabaseUsageStore(admin: AdminClient): UsageStore {
  return {
    async record(row) {
      const { error } = await admin.from("llm_usage").insert({
        product_id: row.productId,
        task: row.task,
        model: row.model,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        cache_read_tokens: row.cacheReadTokens,
        cache_write_tokens: row.cacheWriteTokens,
        cost_usd: row.costUsd,
        created_at: row.at.toISOString(),
      });
      if (error) throw new UsageStoreError(error.code);
    },

    async spentUsd(since, productId) {
      const { data, error } = await admin.rpc("llm_spend_usd", {
        p_since: since.toISOString(),
        ...(productId === null ? {} : { p_product_id: productId }),
      });
      if (error) throw new UsageStoreError(error.code);
      const usd = Number(data);
      // Fail closed: a sum we cannot read must not let a call through.
      if (!Number.isFinite(usd)) throw new UsageStoreError(undefined);
      return usd;
    },
  };
}

import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { UsageRow, UsageStore } from "./ports";

/**
 * llm_usage through the service role (docs/PLAN.md 6.2, 8.1). The table is append-only even for the
 * service role, so this adapter only inserts and sums. Errors carry the Postgres code only.
 */
export function createSupabaseUsageStore(admin: AdminClient): UsageStore {
  return {
    async record(row: UsageRow) {
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
      if (error) throw new Error(`llm_usage insert failed (${error.code})`);
    },

    async usageSince(productId, since, task) {
      const { data, error } = await admin.rpc("llm_usage_since", {
        p_product_id: productId,
        p_since: since.toISOString(),
        p_task: task ?? null,
      });
      if (error) throw new Error(`llm_usage_since failed (${error.code})`);
      const row = data?.[0];
      return { calls: Number(row?.calls ?? 0), costUsd: Number(row?.cost_usd ?? 0) };
    },
  };
}

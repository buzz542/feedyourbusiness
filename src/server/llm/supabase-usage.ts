import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { UsageStore } from "./ports";

/**
 * llm_usage through the service role (docs/PLAN.md 6.2, 8.1). The table is append-only even for the
 * service role; calls reserve their place first (llm_begin_call) and record their usage when they
 * end (llm_finish_call). Errors carry the Postgres code only.
 */
export function createSupabaseUsageStore(admin: AdminClient): UsageStore {
  return {
    async begin(call) {
      const { data, error } = await admin.rpc("llm_begin_call", {
        p_product_id: call.productId,
        p_task: call.task,
        p_now: call.at.toISOString(),
        p_task_daily_calls: call.taskDailyCalls,
        p_product_monthly_usd: call.productMonthlyUsd,
        p_global_daily_usd: call.dailyUsd,
        p_reserve_usd: call.reserveUsd,
        p_lease_seconds: call.leaseSeconds,
      });
      if (error) throw new Error(`llm_begin_call failed (${error.code})`);
      const row = data?.[0];
      if (row?.status === "ok" && row.reservation_id)
        return { kind: "ok", reservationId: row.reservation_id };
      if (
        row?.status === "task_daily" ||
        row?.status === "product_monthly" ||
        row?.status === "global_daily"
      )
        return { kind: "refused", limit: row.status };
      throw new Error("llm_begin_call answered an unknown status");
    },

    async finish(reservationId, row) {
      const { error } = await admin.rpc("llm_finish_call", {
        p_reservation_id: reservationId,
        p_product_id: row.productId,
        p_task: row.task,
        p_model: row.model,
        p_input_tokens: row.inputTokens,
        p_output_tokens: row.outputTokens,
        p_cache_read_tokens: row.cacheReadTokens,
        p_cache_write_tokens: row.cacheWriteTokens,
        p_cost_usd: row.costUsd,
        p_now: row.at.toISOString(),
      });
      if (error) throw new Error(`llm_finish_call failed (${error.code})`);
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

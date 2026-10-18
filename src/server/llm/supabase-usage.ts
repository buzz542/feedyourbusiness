import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { UsageStore } from "./ports";

/** Supabase implementation of the UsageStore port. Needs the service-role client. */
export function createSupabaseUsageStore(db: AdminClient): UsageStore {
  return {
    async record(row) {
      const { error } = await db.from("llm_usage").insert(row);
      // Named, so the wrapper's log line says what failed (never the message: it can echo values).
      if (error)
        throw Object.assign(new Error("Supabase insert failed"), { name: "UsageWriteError" });
    },

    async spendSince({ productId, since }) {
      const { data, error } = await db.rpc("llm_spend_since", {
        p_since: since.toISOString(),
        ...(productId ? { p_product_id: productId } : {}),
      });
      if (error) throw new Error(`Supabase: ${error.message}`);
      return Number(data);
    },
  };
}

import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { sourceProblems } from "./source-health";

/** How far back a failed run still counts: the last two daily runs. */
const LOOKBACK_MS = 2 * 24 * 60 * 60_000;

/**
 * The enabled sources whose latest collect run for this product failed (jobs are invisible to
 * customers, so this reads them with the service role and returns source ids only).
 */
export async function loadSourceProblems(
  productId: string,
  enabled: readonly string[],
  now: Date,
): Promise<string[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("jobs")
    .select("source, status, payload, updated_at")
    .eq("product_id", productId)
    .in("kind", ["collect", "first_run"])
    .gte("updated_at", new Date(now.getTime() - LOOKBACK_MS).toISOString());
  if (error)
    throw Object.assign(new Error("Could not read collect jobs"), { name: "JobsReadError" });
  return sourceProblems(
    (data ?? []).map((r) => ({
      source: r.source ?? "",
      status: r.status,
      result:
        r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
          ? typeof (r.payload as Record<string, unknown>).result === "string"
            ? String((r.payload as Record<string, unknown>).result)
            : null
          : null,
      updatedAt: r.updated_at,
    })),
    enabled,
  );
}

import "server-only";
import type { AdminClient } from "@/server/supabase/admin";
import type { Json } from "@/types/database";
import type { BudgetStore, Job, JobKind, JobStatus, JobStore, ReserveResult } from "./ports";

/** Supabase implementations of the runner's ports. Need the service-role client. */

class JobStoreError extends Error {
  override name = "JobStoreError";
}

/** Errors carry the Postgres code only, never a message that could hold data (2.3.10). */
function must<T>(result: { data: T; error: { code?: string } | null }): T {
  if (result.error) throw new JobStoreError(`Supabase error ${result.error.code ?? "unknown"}`);
  return result.data;
}

export function createSupabaseJobStore(db: AdminClient): JobStore {
  return {
    async claim(now, limit, leaseSeconds) {
      const rows = must(
        await db.rpc("claim_jobs", {
          p_now: now.toISOString(),
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        }),
      );
      return (rows ?? []).map((r): Job => ({
        id: r.id,
        kind: r.kind as JobKind,
        productId: r.product_id,
        source: r.source,
        status: r.status as JobStatus,
        payload:
          r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
            ? (r.payload as Record<string, unknown>)
            : {},
        attempts: r.attempts,
        runAfter: new Date(r.run_after),
      }));
    },

    async finish(id, outcome) {
      must(
        await db.rpc("finish_job", {
          p_id: id,
          p_status: outcome.status,
          ...(outcome.errorClass ? { p_error_class: outcome.errorClass } : {}),
          ...(outcome.payload ? { p_payload: outcome.payload as Json } : {}),
          ...(outcome.runAfter ? { p_run_after: outcome.runAfter.toISOString() } : {}),
        }),
      );
    },

    async enqueue(jobs) {
      if (jobs.length === 0) return 0;
      const rows = must(
        await db
          .from("jobs")
          .upsert(
            jobs.map((j) => ({
              kind: j.kind,
              product_id: j.productId,
              source: j.source,
              dedupe_key: j.dedupeKey,
              payload: (j.payload ?? {}) as Json,
              ...(j.runAfter ? { run_after: j.runAfter.toISOString() } : {}),
            })),
            { onConflict: "dedupe_key", ignoreDuplicates: true },
          )
          .select("id"),
      );
      return rows?.length ?? 0;
    },
  };
}

export function createSupabaseBudgetStore(db: AdminClient): BudgetStore {
  return {
    async reserve(input) {
      const result = must(
        await db.rpc("reserve_job_budget", {
          p_job_id: input.jobId,
          p_product_id: input.productId,
          p_source: input.source,
          p_day: input.day,
          p_units: input.units,
          p_limit: input.limit,
          ...(input.monthlyCap != null ? { p_monthly_cap: input.monthlyCap } : {}),
        }),
      );
      return result as ReserveResult;
    },

    async settle(jobId, actualUnits, costUsd) {
      const settled = must(
        await db.rpc("settle_job_budget", {
          p_job_id: jobId,
          p_actual: actualUnits,
          p_cost_usd: costUsd,
        }),
      );
      return settled === true;
    },
  };
}

/** Confirmed, active products of entitled accounts, with their owners (collectable_products). */
export async function collectableRows(
  db: AdminClient,
): Promise<{ id: string; owner_id: string }[]> {
  return must(await db.rpc("collectable_products")) ?? [];
}

export async function purgeExpired(db: AdminClient, now: Date): Promise<Record<string, number>> {
  const counts = must(await db.rpc("purge_expired", { p_now: now.toISOString() }));
  return counts && typeof counts === "object" && !Array.isArray(counts)
    ? (counts as Record<string, number>)
    : {};
}

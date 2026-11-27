/**
 * Integration errors (the founder's brief, 27 Nov 2026): which sources failed in their latest
 * collect run for a product, so the Reply view says so instead of looking merely empty. Pure; the
 * loader is source-health-server.ts.
 */

export interface CollectJobRow {
  source: string;
  status: string;
  /** payload.result, or null when the job has none yet. */
  result: string | null;
  updatedAt: string;
}

/** Results that mean the source was not read: it failed, timed out, was cut off or could not start. */
const PROBLEMS = new Set(["source_failed", "timeout", "interrupted", "not_ready"]);

export function sourceProblems(
  rows: readonly CollectJobRow[],
  enabled: readonly string[],
): string[] {
  const latest = new Map<string, CollectJobRow>();
  for (const row of rows) {
    const seen = latest.get(row.source);
    if (!seen || Date.parse(row.updatedAt) > Date.parse(seen.updatedAt))
      latest.set(row.source, row);
  }
  return enabled.filter((source) => {
    const row = latest.get(source);
    if (!row) return false;
    return row.status === "failed" || (row.status === "done" && PROBLEMS.has(row.result ?? ""));
  });
}

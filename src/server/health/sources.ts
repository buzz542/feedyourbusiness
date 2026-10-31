import { killSwitchName, sources, vendorClearance } from "@/sources/registry";
import type { CollectSource } from "@/sources/types";
import type { CheckResult } from "./checks";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The `sources` health check (docs/PLAN.md M3): which collect sources are switched on, and for each
 * one that cannot run, why, by env name only: a missing credential, a configuration problem the
 * module reports, or a vendor source held back until its DPA date and snapshot retention are set
 * (2.1.7). Never a value.
 */
export function checkSources(env: Env, now: Date): CheckResult {
  const on = sources.filter(
    (s): s is CollectSource => s.mode === "collect" && env[killSwitchName(s)] === "true",
  );
  if (on.length === 0) return { status: "ok", detail: "no collect source is on" };

  const problems: string[] = [];
  for (const source of on) {
    const missing = (source.requiredCredentials ?? []).filter((name) => !env[name]?.trim());
    if (missing.length) problems.push(`${source.id} missing ${missing.join(", ")}`);
    // Read what a run reads: only the names the source declares (ctx.credential).
    const read = (name: string) => (source.credentials.includes(name) ? env[name] : undefined);
    for (const problem of source.configProblems?.(read) ?? [])
      problems.push(`${source.id}: ${problem}`);
    const clearance = vendorClearance(source, env, now);
    if (clearance === "dpa_missing")
      problems.push(`${source.id} held: ${source.vendor?.dpaSignedOnEnv ?? "DPA date"}`);
    if (clearance === "notice_missing")
      problems.push(`${source.id} held: snapshot retention not stated`);
  }
  const detail = `on: ${on.map((s) => s.id).join(", ")}`;
  return problems.length === 0
    ? { status: "ok", detail }
    : { status: "invalid", detail: `${detail}; ${problems.join("; ")}` };
}

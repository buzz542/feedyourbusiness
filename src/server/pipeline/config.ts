import type { CollectSource } from "@/sources/types";

/** Descriptive, with a monitored contact (docs/PLAN.md 7.4), on every source request. */
export const SOURCE_USER_AGENT = "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)";

/**
 * BRIGHTDATA_MONTHLY_RECORD_CAP for vendor sources (docs/PLAN.md 7.7), default 20,000. New
 * collection may use 90 percent of it; the other 10 percent is held for deletion re-checks (2.3.6),
 * which may use the whole cap.
 */
export function monthlyCapFor(
  source: Pick<CollectSource, "access">,
  env: Readonly<Record<string, string | undefined>> = process.env,
  purpose: "collect" | "recheck" = "collect",
): number | null {
  if (source.access !== "vendor_api") return null;
  const raw = env.BRIGHTDATA_MONTHLY_RECORD_CAP?.trim();
  // A value that is not a whole number stops vendor calls rather than lifting the cap.
  const cap = raw === undefined || raw === "" ? 20_000 : /^\d+$/.test(raw) ? Number(raw) : 0;
  return purpose === "recheck" ? cap : Math.floor(cap * 0.9);
}

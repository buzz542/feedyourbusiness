import type { CollectSource } from "@/sources/types";

/** Descriptive, with a monitored contact (docs/PLAN.md 7.4), on every source request. */
export const SOURCE_USER_AGENT = "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)";

/** BRIGHTDATA_MONTHLY_RECORD_CAP for vendor sources (docs/PLAN.md 7.7), default 20,000. */
export function monthlyCapFor(
  source: Pick<CollectSource, "access">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | null {
  if (source.access !== "vendor_api") return null;
  const raw = env.BRIGHTDATA_MONTHLY_RECORD_CAP?.trim();
  if (raw === undefined || raw === "") return 20_000;
  // A value that is not a whole number stops vendor collection rather than lifting the cap.
  return /^\d+$/.test(raw) ? Number(raw) : 0;
}

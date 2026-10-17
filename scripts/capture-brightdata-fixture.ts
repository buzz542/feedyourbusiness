/**
 * F8 (docs/PLAN.md 7.7, docs/TASKS.md M3): run once by the founder, on their own machine, with the
 * real Bright Data token. It starts one small keyword search through the Reddit source's own pinned
 * code (5 records, under a cent), saves the raw snapshot to the git-ignored fixtures-local/, checks
 * it against the schema, prints PASS or FAIL with counts and field names only, and deletes the
 * capture. It never prints a value from a record, so no real post or username leaves the machine.
 *
 * Usage (BRIGHTDATA_API_TOKEN and BRIGHTDATA_REDDIT_DATASET_ID set in the shell):
 *   set -a; . ./.env.local; set +a; npm run capture:brightdata
 */
import { createSourceFetch } from "@/server/net/source-fetch";
import { reddit } from "@/sources/reddit";
import type { CollectContext } from "@/sources/types";

export interface CaptureDeps {
  env: Readonly<Record<string, string | undefined>>;
  fetchImpl: typeof globalThis.fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  writeFile: (path: string, text: string) => void;
  removeFile: (path: string) => void;
  log: (line: string) => void;
}

/** Field names that would carry the NSFW flag; the module reads each (src/sources/reddit-brightdata.ts). */
const NSFW_FIELDS = ["nsfw", "is_nsfw", "over_18", "over18"];
/** Fields the Reddit source maps (docs/PLAN.md 7.7). */
const MAPPED = [
  "post_id",
  "url",
  "user_posted",
  "title",
  "description",
  "date_posted",
  "community_name",
];
const POLL_MS = 15_000;
const MAX_POLLS = 40;

/** Top-level field names, and one level of nested ones as "parent.child". Never values. */
function fieldNames(records: unknown[]): string[] {
  const names = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    for (const [key, value] of Object.entries(record)) {
      names.add(key);
      const nested = Array.isArray(value) ? value[0] : value;
      if (nested && typeof nested === "object")
        for (const child of Object.keys(nested)) names.add(`${key}.${child}`);
    }
  }
  return [...names].sort();
}

/** True when the capture passes. */
export async function captureBrightdataFixture(deps: CaptureDeps): Promise<boolean> {
  const env: Readonly<Record<string, string | undefined>> = {
    ...deps.env,
    SOURCE_REDDIT_ENABLED: "true",
  };
  const sourceFetch = createSourceFetch(reddit, { env, fetchImpl: deps.fetchImpl });
  const path = `fixtures-local/brightdata-reddit-${deps.now().getTime()}.json`;
  let raw: string | null = null;

  // The snapshot body is copied as it arrives; everything else passes straight through.
  const teeing: CollectContext["fetch"] = async (input, init) => {
    const response = await sourceFetch(input, init);
    if (/\/datasets\/v3\/snapshot\//.test(String(input)) && response.status === 200)
      raw = await response.clone().text();
    return response;
  };

  const now = deps.now();
  const ctx: CollectContext = {
    fetch: teeing,
    terms: [{ id: "capture", term: "invoice software" }],
    since: new Date(now.getTime() - 7 * 24 * 60 * 60_000),
    budget: 5,
    now,
    userAgent: "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)",
    sleep: deps.sleep,
    credential: (name) => env[name],
  };

  let state = await reddit.start(ctx);
  for (let polls = 0; state.kind === "pending" && polls < MAX_POLLS; polls++) {
    await deps.sleep(POLL_MS);
    state = await reddit.poll!(ctx, state.handle);
  }
  if (state.kind === "failed") {
    deps.log(`FAIL: the run failed with ${state.errorClass}.`);
    return false;
  }
  if (state.kind === "pending") {
    deps.log("FAIL: the snapshot was not ready after 10 minutes. Run it again later.");
    return false;
  }
  if (raw === null) {
    deps.log("FAIL: no snapshot was downloaded.");
    return false;
  }

  deps.writeFile(path, raw);
  try {
    const records = JSON.parse(raw) as unknown[];
    const errors = records.filter((r) => r && typeof r === "object" && "error" in r).length;
    const fields = fieldNames(records.filter((r) => r && typeof r === "object" && !("error" in r)));
    const missing = MAPPED.filter((f) => !fields.includes(f));
    const nsfw = NSFW_FIELDS.filter((f) => fields.includes(f));
    deps.log(`Records: ${records.length} (${errors} error records), billed units: ${state.units}`);
    deps.log(`Kept after the source's filters: ${state.posts.length}`);
    deps.log(`Field names: ${fields.join(", ")}`);
    deps.log(`Mapped fields missing: ${missing.length ? missing.join(", ") : "none"}`);
    deps.log(`NSFW fields present: ${nsfw.length ? nsfw.join(", ") : "none"}`);
    if (missing.length > 0) {
      deps.log("FAIL: the schema does not match. Send the field names above to the build session.");
      return false;
    }
    if (nsfw.length === 0) {
      deps.log(
        "FAIL: no known NSFW field. Keep Reddit off and send the field names above to the build session.",
      );
      return false;
    }
    deps.log("PASS");
    return true;
  } finally {
    deps.removeFile(path);
  }
}

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
/** Fields that would mark a private or quarantined community (2.1.2); the module reads each. */
const COMMUNITY_TYPE_FIELDS = ["quarantine", "is_quarantined", "community_type", "subreddit_type"];
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

/**
 * Top-level field names, and one level of nested ones as "parent.child". Never values: a nested
 * key only one record has could be a value used as a key (a username, say), so it is not printed.
 */
function fieldNames(records: unknown[]): string[] {
  const names = new Set<string>();
  const nestedSeen = new Map<string, number>();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    for (const [key, value] of Object.entries(record)) {
      names.add(key);
      const nested = Array.isArray(value) ? value[0] : value;
      if (nested && typeof nested === "object")
        for (const child of Object.keys(nested))
          nestedSeen.set(`${key}.${child}`, (nestedSeen.get(`${key}.${child}`) ?? 0) + 1);
    }
  }
  for (const [name, count] of nestedSeen) if (count >= 2) names.add(name);
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
  if (state.kind === "pending") {
    deps.log("FAIL: the snapshot was not ready after 10 minutes. Run it again later.");
    return false;
  }
  if (raw === null) {
    deps.log(
      state.kind === "failed"
        ? `FAIL: the run failed with ${state.errorClass}.`
        : "FAIL: no snapshot was downloaded.",
    );
    return false;
  }

  // A failed run with a downloaded snapshot is the case the field names are most needed for.
  deps.writeFile(path, raw);
  try {
    let records: unknown[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new TypeError("not an array");
      records = parsed;
    } catch {
      deps.log("FAIL: the snapshot is not a JSON array.");
      return false;
    }
    const errors = records.filter((r) => r && typeof r === "object" && "error" in r).length;
    const fields = fieldNames(records.filter((r) => r && typeof r === "object" && !("error" in r)));
    const missing = MAPPED.filter((f) => !fields.includes(f));
    const nsfw = NSFW_FIELDS.filter((f) => fields.includes(f));
    const communityType = COMMUNITY_TYPE_FIELDS.filter((f) => fields.includes(f));
    deps.log(
      `Records: ${records.length} (${errors} error records)` +
        (state.kind === "done" ? `, billed units: ${state.units}` : ""),
    );
    if (state.kind === "done") deps.log(`Kept after the source's filters: ${state.posts.length}`);
    deps.log(`Field names: ${fields.join(", ")}`);
    deps.log(`Mapped fields missing: ${missing.length ? missing.join(", ") : "none"}`);
    deps.log(`NSFW fields present: ${nsfw.length ? nsfw.join(", ") : "none"}`);
    deps.log(
      `Community type fields present: ${communityType.length ? communityType.join(", ") : "none"}`,
    );
    if (communityType.length === 0)
      deps.log(
        "NOTE: ask Bright Data to confirm in writing that the dataset never returns posts from private or quarantined communities (F8).",
      );
    if (state.kind === "failed") {
      deps.log(
        `FAIL: the run failed with ${state.errorClass}. Send the field names above to the build session.`,
      );
      return false;
    }
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

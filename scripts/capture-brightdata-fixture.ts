import { join, relative, resolve, sep } from "node:path";
import { createSourceFetch } from "@/server/net/source-fetch";
import { SOURCE_USER_AGENT } from "@/server/pipeline/config";
import { reddit } from "@/sources/reddit";
import {
  brightdataProvider,
  classifySnapshotRecord,
  downloadSnapshot,
  parseSnapshot,
} from "@/sources/reddit-brightdata";
import { isEnabled, isLocalRun } from "@/sources/registry";
import type { CollectContext } from "@/sources/types";

/**
 * F8's live check of the Reddit schema (docs/PLAN.md 2.3.13, 7.7; docs/TASKS.md M3). The founder runs
 * it once, on their own machine, never in a build session or CI:
 *
 *   SOURCE_REDDIT_ENABLED=true CAPTURE_LIVE=1 npm run capture:brightdata
 *
 * with BRIGHTDATA_API_TOKEN and BRIGHTDATA_REDDIT_DATASET_ID in the shell or in `.env.local`. It asks
 * Bright Data for at most 5 posts on one keyword (CAPTURE_KEYWORD, a few cents), through the Reddit
 * source's own pinned requests and safeFetch. The snapshot is written only to the git-ignored
 * `fixtures-local/`, read back and checked against the schema the Reddit source uses, then deleted,
 * whatever the outcome. It prints PASS or FAIL, counts and field names only: never a value, the
 * snapshot id or the token. Real responses never enter the build session or the repo.
 */

type Env = Readonly<Record<string, string | undefined>>;

export interface CaptureFs {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, text: string): Promise<void>;
  readFile(path: string): Promise<string>;
  rm(path: string): Promise<void>;
}

export interface CaptureDeps {
  /** The repo root: `.gitignore` and `fixtures-local/` are read and written under it. */
  root: string;
  env: Env;
  /** The transport under safeFetch. */
  fetchImpl?: typeof globalThis.fetch;
  fs: CaptureFs;
  print(line: string): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
  keyword?: string;
}

const CAPTURE_DIR = "fixtures-local";
const POSTS = 5;
const WINDOW_HOURS = 7 * 24;
const POLL_MS = 15_000;
/** Brief vendor or network errors tolerated while waiting, so a paid snapshot is not thrown away. */
const TRANSIENT_ERRORS = 3;
const DEADLINE_MS = 30 * 60_000;
/**
 * Keys printed as field names: plain names found in more than half the records (all of them when
 * there is one), so a value used as a key is never printed. Anything else is counted, never shown.
 */
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const DEFAULT_KEYWORD = "invoice software";

const errorClass = (error: unknown) => (error instanceof Error ? error.name : "Error");

/** The capture path, refused unless it sits directly inside <root>/fixtures-local/. */
function capturePath(root: string, now: Date): string {
  const dir = resolve(root, CAPTURE_DIR);
  const path = resolve(dir, `reddit-${now.getTime()}.json`);
  if (relative(dir, path).split(sep).length !== 1 || !path.startsWith(dir + sep))
    throw Object.assign(new Error("outside fixtures-local"), { name: "CapturePathRefused" });
  return path;
}

async function isGitIgnored(deps: CaptureDeps): Promise<boolean> {
  try {
    const lines = (await deps.fs.readFile(join(deps.root, ".gitignore"))).split(/\r?\n/);
    return lines.some((line) => ["fixtures-local/", "/fixtures-local/"].includes(line.trim()));
  } catch {
    return false;
  }
}

/** Counts and top-level field names only. */
export function summarizeSnapshot(records: readonly unknown[]) {
  const counts = { post: 0, error: 0, unreadable: 0 };
  const seen = new Map<string, number>();
  let objects = 0;
  for (const raw of records) {
    counts[classifySnapshotRecord(raw)]++;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      objects++;
      for (const key of Object.keys(raw)) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const shown = (key: string, count: number) =>
    FIELD_NAME.test(key) && (objects === 1 || count > objects / 2);
  const fields = [...seen].filter(([key, count]) => shown(key, count)).map(([key]) => key);
  return {
    pass: counts.post > 0 && counts.unreadable === 0,
    records: records.length,
    ...counts,
    fields: fields.sort(),
    hiddenKeys: seen.size - fields.length,
  };
}

export async function captureBrightdataFixture(deps: CaptureDeps): Promise<{ pass: boolean }> {
  const fail = (reason: string) => {
    deps.print(`FAIL: ${reason}`);
    return { pass: false };
  };

  if (!isLocalRun(deps.env)) return fail("run this on your own machine, not on a deployment");
  if (!(await isGitIgnored(deps)))
    return fail("fixtures-local/ is not in .gitignore; nothing was requested");
  if (!isEnabled(reddit, deps.env))
    return fail("set SOURCE_REDDIT_ENABLED=true for this run; nothing was requested");

  const keyword = (deps.keyword ?? DEFAULT_KEYWORD).trim();
  if (keyword.length < 2 || keyword.length > 100)
    return fail("CAPTURE_KEYWORD must be 2 to 100 characters");

  const env = deps.env;
  const ctx: CollectContext = {
    fetch: createSourceFetch(reddit, {
      env,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    }),
    terms: [],
    since: new Date(deps.now().getTime() - WINDOW_HOURS * 3_600_000),
    budget: POSTS,
    now: deps.now(),
    userAgent: SOURCE_USER_AGENT,
    sleep: deps.sleep,
    credential: (name) => (reddit.credentials.includes(name) ? env[name] || undefined : undefined),
  };

  let text: string;
  try {
    const snapshotId = await brightdataProvider.start(ctx, [
      { keyword, limit: POSTS, windowHours: WINDOW_HOURS },
    ]);
    deps.print("Requested. Waiting for Bright Data (up to 30 minutes)...");
    const deadline = deps.now().getTime() + DEADLINE_MS;
    let errors = 0;
    for (;;) {
      try {
        const download = await downloadSnapshot(ctx, snapshotId);
        if (download.kind === "ready") {
          text = download.text;
          break;
        }
      } catch (error) {
        // A failed vendor run or an oversized snapshot is final; a 5xx or a dropped connection is not.
        const name = errorClass(error);
        const transient =
          /^Http5\d\d$/.test(name) || name === "TypeError" || name === "TimeoutError";
        if (!transient || ++errors > TRANSIENT_ERRORS) throw error;
      }
      if (deps.now().getTime() >= deadline) return fail("the snapshot was not ready in 30 minutes");
      await deps.sleep(POLL_MS);
    }
  } catch (error) {
    return fail(errorClass(error));
  }

  let path: string;
  try {
    path = capturePath(deps.root, deps.now());
  } catch (error) {
    return fail(errorClass(error));
  }
  // From here the file may exist, even half written: every path out deletes it.
  try {
    await deps.fs.mkdir(resolve(deps.root, CAPTURE_DIR));
    await deps.fs.writeFile(path, text);
    const snapshot = parseSnapshot(await deps.fs.readFile(path));
    if (snapshot.kind === "pending")
      return fail("the vendor sent a pending status as the snapshot");
    const summary = summarizeSnapshot(snapshot.records);
    deps.print(
      `${summary.pass ? "PASS" : "FAIL"}: ${summary.records} records, ${summary.post} match the schema, ` +
        `${summary.error} error records, ${summary.unreadable} do not match`,
    );
    deps.print(`Fields: ${summary.fields.join(", ") || "(none)"}`);
    if (summary.hiddenKeys > 0)
      deps.print(
        `${summary.hiddenKeys} other key${summary.hiddenKeys === 1 ? "" : "s"} not shown (not a plain field name, or in too few records)`,
      );
    return { pass: summary.pass };
  } catch (error) {
    return fail(errorClass(error));
  } finally {
    try {
      await deps.fs.rm(path);
      deps.print("The capture was deleted.");
    } catch {
      deps.print("Could not delete the capture: delete fixtures-local/ by hand now.");
    }
  }
}

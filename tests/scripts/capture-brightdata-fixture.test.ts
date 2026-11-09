import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureBrightdataFixture,
  type CaptureDeps,
  type CaptureFs,
} from "../../scripts/capture-brightdata-fixture";

/**
 * F8's live check (docs/PLAN.md 2.3.13, 7.7, docs/TASKS.md M3): the capture is written only to the
 * git-ignored fixtures-local/, checked against the Reddit schema there, reported as pass or fail
 * with field names only, then deleted. Here the vendor is a fake fetch serving synthetic records.
 */

const DATASET = "gd_lvz8ah06191smkebj4";
const snapshot = readFileSync("tests/fixtures/reddit/snapshot.json", "utf8");

type Http = (input: string | URL, init?: RequestInit) => Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function fakeVendor(snapshotBody: string, progress: string[] = ["running", "ready"]) {
  const states = [...progress];
  return vi.fn<Http>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/datasets/v3/trigger") return json({ snapshot_id: "s_capture1" });
    if (url.pathname.startsWith("/datasets/v3/progress/"))
      return json({ status: states.length > 1 ? states.shift() : states[0] });
    if (url.pathname.startsWith("/datasets/v3/snapshot/")) return json(snapshotBody);
    throw new Error("unrouted");
  });
}

/** Every string anywhere in a JSON value: none may reach the output. */
function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

let root: string;
let printed: string[];
let writes: string[];

function trackedFs(): CaptureFs {
  const real: CaptureFs = {
    mkdir: async (path) => void mkdirSync(path, { recursive: true }),
    writeFile: async (path, text) => writeFileSync(path, text),
    readFile: async (path) => readFileSync(path, "utf8"),
    rm: async (path) => rmSync(path, { force: true }),
  };
  return {
    ...real,
    writeFile: async (path, text) => {
      writes.push(path);
      return real.writeFile(path, text);
    },
  };
}

function deps(http: Http, over: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    root,
    env: {
      SOURCE_REDDIT_ENABLED: "true",
      BRIGHTDATA_API_TOKEN: "test-token",
      BRIGHTDATA_REDDIT_DATASET_ID: DATASET,
    },
    fetchImpl: http as typeof fetch,
    fs: trackedFs(),
    print: (line) => printed.push(line),
    sleep: vi.fn(async () => {}),
    now: () => new Date("2026-11-09T09:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "capture-"));
  writeFileSync(join(root, ".gitignore"), "node_modules\nfixtures-local/\n");
  printed = [];
  writes = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("scripts/capture-brightdata-fixture.ts", () => {
  it("passes a snapshot that matches the schema and prints the field names", async () => {
    const http = fakeVendor(snapshot);
    const result = await captureBrightdataFixture(deps(http));
    expect(result.pass).toBe(true);
    const out = printed.join("\n");
    expect(out).toMatch(/^PASS/m);
    for (const field of ["post_id", "url", "user_posted", "date_posted", "community_name"])
      expect(out).toContain(field);
  });

  it("writes only inside fixtures-local/ and deletes the capture", async () => {
    await captureBrightdataFixture(deps(fakeVendor(snapshot)));
    expect(writes.length).toBeGreaterThan(0);
    for (const path of writes)
      expect(relative(root, path).split(sep)[0], path).toBe("fixtures-local");
    // Only the .gitignore is left: the capture is gone.
    expect(filesUnder(root).map((f) => relative(root, f))).toEqual([".gitignore"]);
  });

  it("prints no field value, only names and counts", async () => {
    await captureBrightdataFixture(deps(fakeVendor(snapshot)));
    const out = printed.join("\n");
    const values = stringValues(JSON.parse(snapshot)).filter((v) => v.trim().length >= 3);
    expect(values.length).toBeGreaterThan(10);
    for (const value of values) expect(out, value).not.toContain(value);
    expect(out).not.toContain("s_capture1");
    expect(out).not.toContain("test-token");
  });

  it("never prints a key that does not look like a field name", async () => {
    const records = JSON.parse(snapshot) as Record<string, unknown>[];
    records[0] = { ...records[0], "Example Person said hi": true };
    await captureBrightdataFixture(deps(fakeVendor(JSON.stringify(records))));
    const out = printed.join("\n");
    expect(out).not.toContain("Example Person");
    expect(out).toMatch(/1 other key not shown/);
  });

  it("fails, and still deletes the capture, when a record does not match the schema", async () => {
    const records = JSON.parse(snapshot) as Record<string, unknown>[];
    // The NSFW field renamed: the schema fails closed (src/sources/reddit-brightdata.ts).
    const renamed: Record<string, unknown> = { ...records[0], adult_content: false };
    for (const key of ["nsfw", "is_nsfw", "over_18", "over18"]) delete renamed[key];
    records[0] = renamed;
    const result = await captureBrightdataFixture(deps(fakeVendor(JSON.stringify(records))));
    expect(result.pass).toBe(false);
    expect(printed.join("\n")).toMatch(/^FAIL/m);
    expect(printed.join("\n")).toContain("adult_content");
    expect(filesUnder(root).map((f) => relative(root, f))).toEqual([".gitignore"]);
  });

  it("fails on a snapshot that is not a list of records, and deletes it", async () => {
    const result = await captureBrightdataFixture(deps(fakeVendor('{"oops": "Example text"}')));
    expect(result.pass).toBe(false);
    expect(printed.join("\n")).not.toContain("Example text");
    expect(filesUnder(root).map((f) => relative(root, f))).toEqual([".gitignore"]);
  });

  it("asks for a handful of posts on one keyword, on the pinned dataset only", async () => {
    const http = fakeVendor(snapshot);
    await captureBrightdataFixture(deps(http, { keyword: "invoice reminders" }));
    const trigger = http.mock.calls.find(([url]) => String(url).includes("/trigger"))!;
    const url = new URL(String(trigger[0]));
    expect(url.searchParams.get("dataset_id")).toBe(DATASET);
    const inputs = JSON.parse(String(trigger[1]?.body)) as {
      keyword: string;
      num_of_posts: number;
    }[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.keyword).toBe("invoice reminders");
    expect(inputs[0]!.num_of_posts).toBeLessThanOrEqual(5);
  });

  it("waits between progress checks and gives up after its deadline", async () => {
    let clock = Date.parse("2026-11-09T09:00:00Z");
    const sleep = vi.fn(async (ms: number) => void (clock += ms));
    const http = fakeVendor(snapshot, ["running"]);
    const result = await captureBrightdataFixture(
      deps(http, { sleep, now: () => new Date(clock) }),
    );
    expect(result.pass).toBe(false);
    expect(printed.join("\n")).toMatch(/^FAIL/m);
    expect(sleep).toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each([
    ["the kill switch is off", { SOURCE_REDDIT_ENABLED: "false" }],
    ["the token is missing", { BRIGHTDATA_API_TOKEN: "" }],
    ["the dataset id is not pinned", { BRIGHTDATA_REDDIT_DATASET_ID: "gd_l1viktl72bvl7bjuj0" }],
    ["it runs on a deployment", { VERCEL_ENV: "production" }],
  ])("refuses to start when %s, with no request and no file", async (_case, env) => {
    const http = fakeVendor(snapshot);
    const base = deps(http);
    const result = await captureBrightdataFixture({ ...base, env: { ...base.env, ...env } });
    expect(result.pass).toBe(false);
    expect(http).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("refuses to start unless fixtures-local/ is git-ignored", async () => {
    writeFileSync(join(root, ".gitignore"), "node_modules\n");
    const http = fakeVendor(snapshot);
    const result = await captureBrightdataFixture(deps(http));
    expect(result.pass).toBe(false);
    expect(printed.join("\n")).toContain("fixtures-local/");
    expect(http).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("the repo's own .gitignore ignores fixtures-local/", () => {
    expect(readFileSync(".gitignore", "utf8").split("\n")).toContain("fixtures-local/");
  });
});

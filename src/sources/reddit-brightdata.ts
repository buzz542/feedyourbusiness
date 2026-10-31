import { z } from "zod";
import type { RedditProvider, RedditQuery, RedditRecord, RedditRun } from "./reddit-provider";
import { BRIGHTDATA_API_HOST } from "./reddit-vendor";
import type { CollectContext } from "./types";

/**
 * The Bright Data provider for Reddit (docs/PLAN.md 7.7, D1): the Web Scraper API's Reddit posts
 * dataset, discovered by keyword. Every request goes through pinnedFetch(), which refuses any path,
 * method, parameter or dataset id other than the pinned ones before anything is sent (2.1.9).
 *
 * Checked 17 Oct 2026 against Bright Data's own code on GitHub (docs.brightdata.com and
 * brightdata.com could not be reached from the build session):
 * - github.com/brightdata/sdk-python (commit 1fc5aa8, 12 Aug 2026): Reddit posts dataset
 *   gd_lvz8ah06191smkebj4; keyword discovery is type=discover_new&discover_by=keyword with inputs
 *   keyword, date ("All time", "Past year", "Past month", "Past week", "Past 24 hours",
 *   "Past hour"), num_of_posts and sort_by ("Hot", "Top", "New", "Rising"); trigger
 *   POST /datasets/v3/trigger?dataset_id=...&include_errors=true with the input array as the body,
 *   answering { snapshot_id }; GET /datasets/v3/progress/<id> answering { status };
 *   GET /datasets/v3/snapshot/<id>?format=json, which answers 202 while the data is still building.
 * - github.com/brightdata/brightdata-mcp (commit f3e945d, 15 Oct 2026): the same three paths; run
 *   statuses starting, running, building, ready, failed and canceled; error records carry an
 *   `error` field; `custom_output_fields` is a trigger parameter.
 * Re-checked 31 Oct 2026 by web search of docs.brightdata.com (the pages themselves could not be
 * fetched; the build session's proxy refuses the host): the "Reddit posts, discover by keyword"
 * dataset is still gd_lvz8ah06191smkebj4, keyword discovery is type=discover_new&discover_by=keyword,
 * the async /datasets/v3/trigger flow is the one recommended for discovery, and the inputs are
 * keyword, date ("Past week", "Past month" and the other Reddit time ranges) and num_of_posts.
 * Unverified (a founder step before Reddit is switched on, F8 and docs/TASKS.md M3): sort_by, the record
 * fields beyond those the plan maps, the name of the NSFW field, the multi-field syntax of
 * custom_output_fields (so the trigger does not limit fields yet), whether a snapshot can be deleted
 * (so none is), how long Bright Data keeps snapshots, and the price per 1,000 records.
 */

/** Reddit posts, discover by keyword. Any other dataset id is refused, from code or from the env. */
export const PINNED_DATASET_IDS: readonly string[] = ["gd_lvz8ah06191smkebj4"];

/** A literal: the hosts gate allows no URL built from a host variable. Equals BRIGHTDATA_API_HOST. */
export const API = "https://api.brightdata.com";
const TRIGGER_PATH = "/datasets/v3/trigger";
const PROGRESS_PATH = /^\/datasets\/v3\/progress\/[A-Za-z0-9_-]{1,100}$/;
const SNAPSHOT_PATH = /^\/datasets\/v3\/snapshot\/[A-Za-z0-9_-]{1,100}$/;
const SNAPSHOT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** The most a snapshot download may be (docs/PLAN.md 7.7). */
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

type DateFilter = "Past hour" | "Past 24 hours" | "Past week" | "Past month" | "Past year";

/** The narrowest date filter that still covers the window. */
export function dateFilterFor(windowHours: number): DateFilter {
  if (windowHours <= 1) return "Past hour";
  if (windowHours <= 24) return "Past 24 hours";
  if (windowHours <= 7 * 24) return "Past week";
  if (windowHours <= 31 * 24) return "Past month";
  return "Past year";
}

export class VendorRequestRefused extends Error {
  constructor(readonly reason: string) {
    super(`Refused a request to the data vendor: ${reason}`);
    this.name = "VendorRequestRefused";
  }
}

const named = (name: string, message: string) => Object.assign(new Error(message), { name });
const httpError = (response: Response) =>
  named(`Http${response.status}`, "The vendor answered with an error");

/**
 * The only requests this module may make: keyword discovery on a pinned dataset, the progress of a
 * snapshot, and its JSON download. Checked on the URL exactly as it will be sent.
 */
export function assertPinnedRequest(raw: string, method: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new VendorRequestRefused("not a URL");
  }
  if (
    url.protocol !== "https:" ||
    url.host !== BRIGHTDATA_API_HOST ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new VendorRequestRefused("not the vendor's API host");
  const params = [...url.searchParams.entries()];
  const exactly = (expected: Record<string, string>) =>
    params.length === Object.keys(expected).length &&
    params.every(([key, value]) => expected[key] === value);

  if (url.pathname === TRIGGER_PATH) {
    if (method !== "POST") throw new VendorRequestRefused("a trigger must be a POST");
    const datasetId = url.searchParams.get("dataset_id") ?? "";
    if (!PINNED_DATASET_IDS.includes(datasetId))
      throw new VendorRequestRefused("the dataset id is not pinned");
    const discovery = {
      dataset_id: datasetId,
      type: "discover_new",
      discover_by: "keyword",
      include_errors: "true",
    };
    // Collection by URL, for the deletion re-check: the same dataset, nothing else.
    const byUrl = { dataset_id: datasetId, include_errors: "true" };
    if (!exactly(discovery) && !exactly(byUrl))
      throw new VendorRequestRefused("unexpected trigger parameters");
    return;
  }
  if (PROGRESS_PATH.test(url.pathname)) {
    if (method !== "GET" || params.length > 0)
      throw new VendorRequestRefused("unexpected progress request");
    return;
  }
  if (SNAPSHOT_PATH.test(url.pathname)) {
    if (method !== "GET" || !exactly({ format: "json" }))
      throw new VendorRequestRefused("unexpected snapshot request");
    return;
  }
  throw new VendorRequestRefused("the path is not pinned");
}

/** ctx.fetch behind the pin: a refused request never reaches the network. */
function pinnedFetch(ctx: CollectContext, token: string) {
  return async (url: string, init: { method: "GET" | "POST"; body?: string }) => {
    assertPinnedRequest(url, init.method);
    return ctx.fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": ctx.userAgent,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  };
}

/** The response body as text, refusing more than `max` bytes without reading the rest. */
export async function readCapped(response: Response, max = MAX_SNAPSHOT_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel();
    throw named("SnapshotTooLarge", "The snapshot is larger than the cap");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw named("SnapshotTooLarge", "The snapshot is larger than the cap");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** BRIGHTDATA_API_TOKEN and BRIGHTDATA_REDDIT_DATASET_ID, checked before any request. */
function config(ctx: CollectContext): { token: string; datasetId: string } {
  const token = ctx.credential("BRIGHTDATA_API_TOKEN");
  if (!token) throw named("MissingCredentials", "BRIGHTDATA_API_TOKEN is not set");
  const datasetId = ctx.credential("BRIGHTDATA_REDDIT_DATASET_ID") ?? "";
  if (!PINNED_DATASET_IDS.includes(datasetId))
    throw named("DatasetNotPinned", "BRIGHTDATA_REDDIT_DATASET_ID is not a pinned dataset id");
  return { token, datasetId };
}

const TriggerResponse = z.object({ snapshot_id: z.string().regex(SNAPSHOT_ID) });
const ProgressResponse = z.object({ status: z.string() });
const ErrorRecord = z.object({ error: z.unknown() }).refine((r) => r.error != null);
const Input = z.object({ keyword: z.string() }).partial().nullish();
/**
 * The mapped fields only (zod drops every other field). NSFW: the field name is not confirmed yet,
 * so each likely name is read, and any true value or an "nsfw" tag marks the post. It fails
 * closed: a post record with none of those fields as a boolean is unreadable, so a renamed or
 * nested field makes the run fail (and the founder's F8 capture print "fail") instead of letting
 * every post through as safe (2.1.2). Community type
 * (2.1.2, private and quarantined communities): likewise unconfirmed, so each likely field is read
 * and anything but "public" restricts the post.
 */
const PostRecord = z
  .object({
    post_id: z.string().min(1).max(40),
    url: z.string().max(2_000),
    user_posted: z.string().max(100).nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    date_posted: z.string().max(40),
    community_name: z.string().max(100).nullish(),
    nsfw: z.boolean().nullish(),
    is_nsfw: z.boolean().nullish(),
    over_18: z.boolean().nullish(),
    over18: z.boolean().nullish(),
    tags: z.array(z.string()).nullish(),
    quarantine: z.boolean().nullish(),
    is_quarantined: z.boolean().nullish(),
    community_type: z.string().max(40).nullish(),
    subreddit_type: z.string().max(40).nullish(),
    discovery_input: Input,
    input: Input,
  })
  .refine((r) => [r.nsfw, r.is_nsfw, r.over_18, r.over18].some((f) => typeof f === "boolean"));

const PENDING_STATUSES = new Set(["starting", "running", "building", "collecting", "digesting"]);
const FAILED_STATUSES = new Set(["failed", "canceled", "cancelled", "error"]);

/** The record mapping, for tests. */
export const toRedditRecordForTest = (raw: unknown) => toRecord(raw);

function toRecord(raw: unknown): RedditRecord | "error" | null {
  if (ErrorRecord.safeParse(raw).success) return "error";
  const parsed = PostRecord.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    postId: r.post_id,
    url: r.url,
    author: r.user_posted ?? null,
    title: r.title ?? "",
    body: r.description ?? "",
    postedAt: r.date_posted,
    community: r.community_name ?? null,
    nsfw:
      [r.nsfw, r.is_nsfw, r.over_18, r.over18].some((flag) => flag === true) ||
      (r.tags ?? []).some((tag) => tag.trim().toLowerCase() === "nsfw"),
    restricted:
      r.quarantine === true ||
      r.is_quarantined === true ||
      [r.community_type, r.subreddit_type].some(
        (type) => type != null && type.trim().toLowerCase() !== "public",
      ),
    keyword: r.discovery_input?.keyword ?? r.input?.keyword ?? null,
  };
}

/** A stored post link exactly as the Reddit source writes it: the only input a re-check sends. */
const STORED_POST_LINK =
  /^https:\/\/www\.reddit\.com\/r\/[A-Za-z0-9_]{2,21}\/comments\/[A-Za-z0-9]{1,12}(?:\/[^/?#\s]*)?\/?$/;

export const brightdataProvider: RedditProvider = {
  id: "brightdata",

  async startByUrl(ctx: CollectContext, urls: readonly string[]): Promise<string> {
    if (urls.length === 0 || urls.some((url) => !STORED_POST_LINK.test(url)))
      throw new VendorRequestRefused("a re-check sends only stored Reddit post links");
    const { token, datasetId } = config(ctx);
    const params = new URLSearchParams({ dataset_id: datasetId, include_errors: "true" });
    const response = await pinnedFetch(ctx, token)(`${API}${TRIGGER_PATH}?${params}`, {
      method: "POST",
      body: JSON.stringify(urls.map((url) => ({ url }))),
    });
    if (!response.ok) throw httpError(response);
    const parsed = TriggerResponse.safeParse(await response.json());
    if (!parsed.success) throw named("InvalidResponse", "The trigger answer did not match");
    return parsed.data.snapshot_id;
  },

  async start(ctx: CollectContext, queries: readonly RedditQuery[]): Promise<string> {
    const { token, datasetId } = config(ctx);
    const inputs = queries.map((q) => ({
      keyword: q.keyword,
      date: dateFilterFor(q.windowHours),
      num_of_posts: q.limit,
      sort_by: "New",
    }));
    const params = new URLSearchParams({
      dataset_id: datasetId,
      type: "discover_new",
      discover_by: "keyword",
      include_errors: "true",
    });
    const response = await pinnedFetch(ctx, token)(`${API}${TRIGGER_PATH}?${params}`, {
      method: "POST",
      body: JSON.stringify(inputs),
    });
    if (!response.ok) throw httpError(response);
    const parsed = TriggerResponse.safeParse(await response.json());
    if (!parsed.success) throw named("InvalidResponse", "The trigger answer did not match");
    return parsed.data.snapshot_id;
  },

  async collect(ctx: CollectContext, snapshotId: string): Promise<RedditRun> {
    if (!SNAPSHOT_ID.test(snapshotId)) throw named("InvalidHandle", "Not a snapshot id");
    const call = pinnedFetch(ctx, config(ctx).token);
    const progress = await call(`${API}/datasets/v3/progress/${snapshotId}`, { method: "GET" });
    if (progress.status === 429) return { kind: "pending" };
    if (!progress.ok) throw httpError(progress);
    const state = ProgressResponse.safeParse(await progress.json());
    if (!state.success) throw named("InvalidResponse", "The progress answer did not match");
    const status = state.data.status.toLowerCase();
    if (FAILED_STATUSES.has(status)) throw named("VendorRunFailed", "The vendor run failed");
    // Unknown statuses wait too; the job gives up after an hour (src/server/pipeline/collect.ts).
    if (status !== "ready") return { kind: "pending" };

    const download = await call(`${API}/datasets/v3/snapshot/${snapshotId}?format=json`, {
      method: "GET",
    });
    if (download.status === 202 || download.status === 429) {
      await download.body?.cancel();
      return { kind: "pending" };
    }
    if (!download.ok) throw httpError(download);
    let body: unknown;
    try {
      body = JSON.parse(await readCapped(download));
    } catch (error) {
      if (error instanceof Error && error.name === "SnapshotTooLarge") throw error;
      throw named("InvalidResponse", "The snapshot is not JSON");
    }
    if (!Array.isArray(body)) {
      const pending = ProgressResponse.safeParse(body);
      if (pending.success && PENDING_STATUSES.has(pending.data.status.toLowerCase()))
        return { kind: "pending" };
      throw named("InvalidResponse", "The snapshot is not a list of records");
    }

    const records: RedditRecord[] = [];
    let unreadable = 0;
    for (const raw of body) {
      const record = toRecord(raw);
      if (record === "error") continue;
      if (record === null) unreadable++;
      else records.push(record);
    }
    // Every post record failing the schema means the shape changed: fail loudly, store nothing.
    if (unreadable > 0 && records.length === 0)
      throw named("InvalidResponse", "No record matched the schema");
    return { kind: "done", records, units: body.length };
  },
};

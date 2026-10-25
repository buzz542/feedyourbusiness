import { z } from "zod";
import { decodeEntities } from "@/lib/html-entities";
import { toExcerpt } from "./text";
import type { CollectContext, CollectedPost, CollectSource, RunState } from "./types";

/**
 * X (docs/PLAN.md 7.6): the official API v2 only, off by default. Recent search per term, billed
 * per post read, with a per-product daily budget that defaults to 0 (no calls even when switched
 * on). Read-only. X content is never used to train or fine-tune any model.
 *
 * Deletion compliance: X requires posts that are deleted or no longer public to be removed.
 * `checkDeleted` looks stored posts up by id (`GET /2/tweets?ids=`, up to 100 a request) during the
 * daily deletion sync; any id the API does not return (deleted, protected, or its account
 * suspended) is deleted here. Lookups are post reads, billed like search: about 0.5 cents per post
 * still live, once a day for each stored X post (7 days at most).
 *
 * Built to the plan's description of recent search (`query`, `start_time`, `max_results` 10 to 100,
 * `tweet.fields`); docs.x.com could not be reached from the build session (17 Oct 2026), so
 * confirming them is part of the founder's step before X is switched on (docs/TASKS.md M3).
 */

/** True only together with a working, tested `checkDeleted` (docs/PLAN.md 7.6). */
const DELETION_COMPLIANCE_READY = true;

const SEARCH_URL = "https://api.x.com/2/tweets/search/recent";
const LOOKUP_URL = "https://api.x.com/2/tweets";
const LOOKUP_BATCH = 100;
const FIELDS = "created_at,author_id,lang,possibly_sensitive";
const MIN_RESULTS = 10;
const MAX_RESULTS = 100;
const PACE_MS = 1_000;
const DEFAULT_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15_000;
/** Recent search reaches back 7 days; a minute's margin keeps start_time inside it. */
const WINDOW_MS = 7 * 24 * 60 * 60_000 - 60_000;

const Post = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  text: z.string(),
  author_id: z.string().regex(/^\d{1,20}$/),
  created_at: z.string(),
  possibly_sensitive: z.boolean().optional(),
});
const SearchResponse = z.object({ data: z.array(Post).optional() });
/** Only the ids are read from a lookup; the text that comes with them is dropped unread. */
const LookupResponse = z.object({ data: z.array(z.object({ id: z.string() })).optional() });
const POST_ID = /^\d{1,20}$/;

const named = (name: string) => Object.assign(new Error(name), { name });

const backoffFrom = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_BACKOFF_MS)
    : DEFAULT_BACKOFF_MS;
};

/** The search itself. start() calls it only once deletion compliance exists. */
export async function collectRecent(ctx: CollectContext): Promise<RunState> {
  const count = Math.min(ctx.terms.length, Math.floor(ctx.budget / MIN_RESULTS));
  if (count <= 0) return { kind: "done", posts: [], units: 0 };
  const perTerm = Math.min(MAX_RESULTS, Math.floor(ctx.budget / count));
  const startTime = new Date(Math.max(ctx.since.getTime(), ctx.now.getTime() - WINDOW_MS));
  const posts = new Map<string, CollectedPost>();
  let units = 0;
  try {
    const token = ctx.credential("X_BEARER_TOKEN");
    if (!token) throw named("MissingCredentials");
    const get = (url: string) =>
      ctx.fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": ctx.userAgent,
          accept: "application/json",
        },
      });
    for (const [index, term] of ctx.terms.slice(0, count).entries()) {
      if (index > 0) await ctx.sleep(PACE_MS);
      const params = new URLSearchParams({
        query: `"${term.term.replaceAll('"', "")}" -is:retweet lang:en`,
        start_time: startTime.toISOString(),
        max_results: String(perTerm),
        "tweet.fields": FIELDS,
      });
      const url = `${SEARCH_URL}?${params}`;
      let response = await get(url);
      if (response.status === 429) {
        await ctx.sleep(backoffFrom(response));
        response = await get(url);
        if (response.status === 429) break;
      }
      if (!response.ok) throw named(`Http${response.status}`);
      const parsed = SearchResponse.safeParse(await response.json());
      if (!parsed.success) throw named("InvalidResponse");
      const found = (parsed.data.data ?? []).slice(0, perTerm);
      units += found.length;
      for (const post of found) {
        if (post.possibly_sensitive || posts.has(post.id)) continue;
        const posted = Date.parse(post.created_at);
        if (Number.isNaN(posted) || posted <= ctx.since.getTime()) continue;
        const excerpt = toExcerpt(decodeEntities(post.text));
        if (!excerpt) continue;
        posts.set(post.id, {
          externalId: post.id,
          url: `https://x.com/i/web/status/${post.id}`,
          excerpt,
          postedAt: new Date(Math.min(posted, ctx.now.getTime())),
          authorKey: post.author_id,
          community: "X",
          termId: term.id,
          nsfw: false,
        });
      }
    }
  } catch (error) {
    return { kind: "failed", errorClass: error instanceof Error ? error.name : "Error" };
  }
  return { kind: "done", posts: [...posts.values()], units };
}

/**
 * Deletion sync (docs/PLAN.md 2.3.6, 7.6): the ids X no longer returns. A failed request throws,
 * so the job retries rather than treating every post as live; a second 429 stops the run with what
 * it found, and the next daily run checks the rest.
 */
async function checkDeleted(
  ctx: CollectContext,
  externalIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(externalIds.filter((id) => POST_ID.test(id)))];
  if (ids.length === 0) return [];
  const token = ctx.credential("X_BEARER_TOKEN");
  if (!token) throw named("MissingCredentials");
  const gone: string[] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    if (i > 0) await ctx.sleep(PACE_MS);
    const batch = ids.slice(i, i + LOOKUP_BATCH);
    const url = `${LOOKUP_URL}?${new URLSearchParams({ ids: batch.join(","), "tweet.fields": "id" })}`;
    const get = () =>
      ctx.fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": ctx.userAgent,
          accept: "application/json",
        },
      });
    let response = await get();
    if (response.status === 429) {
      await ctx.sleep(backoffFrom(response));
      response = await get();
      if (response.status === 429) break;
    }
    if (!response.ok) throw named(`Http${response.status}`);
    const parsed = LookupResponse.safeParse(await response.json());
    if (!parsed.success) throw named("InvalidResponse");
    const live = new Set((parsed.data.data ?? []).map((p) => p.id));
    gone.push(...batch.filter((id) => !live.has(id)));
  }
  return gone;
}

async function start(ctx: CollectContext): Promise<RunState> {
  if (ctx.budget <= 0 || ctx.terms.length === 0) return { kind: "done", posts: [], units: 0 };
  if (!DELETION_COMPLIANCE_READY)
    return { kind: "failed", errorClass: "DeletionComplianceMissing" };
  return collectRecent(ctx);
}

export const x: CollectSource = {
  id: "x",
  displayName: "X",
  mode: "collect",
  access: "official_api",
  termsUrl: "https://developer.x.com/en/developer-terms/agreement-and-policy",
  allowedHosts: ["api.x.com"],
  linkHosts: ["x.com"],
  // X_DAILY_READS_PER_PRODUCT, default 0 (docs/PLAN.md 7.6).
  dailyBudget: 0,
  retentionDays: 7,
  // About $0.005 per post read (pay-per-use); the founder confirms it in the developer console.
  costPerUnitUsd: 0.005,
  credentials: ["X_BEARER_TOKEN"],
  requiredCredentials: ["X_BEARER_TOKEN"],
  configProblems: () =>
    DELETION_COMPLIANCE_READY
      ? []
      : ["refuses to start until deletion compliance is built (docs/PLAN.md 7.6)"],
  start,
  checkDeleted,
};

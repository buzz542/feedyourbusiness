import { z } from "zod";
import { htmlToText, toExcerpt } from "./text";
import type { CollectContext, CollectedPost, CollectSource, RunState } from "./types";

/**
 * Hacker News (docs/PLAN.md 7.4): official and free. Search through Algolia's HN Search API, the
 * existence check through the official Firebase item API. Read-only: nothing here writes to Hacker
 * News.
 *
 * Checked 17 Oct 2026:
 * - Firebase item API, against github.com/HackerNews/API (MIT license): items at
 *   https://hacker-news.firebaseio.com/v0/item/<id>.json with `deleted` and `dead` flags; "There is
 *   currently no rate limit." A missing id is treated as deleted (the README does not say what it
 *   returns; the API answers null).
 * - Algolia HN Search: the endpoint and parameters follow docs/PLAN.md 7.4 (search_by_date with
 *   query, tags=(story,comment), numericFilters=created_at_i>T, hitsPerPage) and Algolia's
 *   documented numericFilters syntax. hn.algolia.com could not be reached from the build session,
 *   so confirming them on hn.algolia.com/api is a founder step before this source is switched on
 *   (docs/TASKS.md M3).
 */

const SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";
const ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";
/** At most 2 requests a second. */
const PACE_MS = 500;
const MAX_PER_TERM = 100;
const DEFAULT_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 10_000;

const Hit = z.object({
  objectID: z.string().regex(/^\d+$/),
  author: z.string().min(1),
  created_at_i: z.number().int(),
  title: z.string().nullish(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
  _tags: z.array(z.string()).optional(),
});
/** Hits are parsed one by one: a malformed hit is skipped, not the run. */
const SearchResponse = z.object({ hits: z.array(z.unknown()) });
const Item = z.object({ deleted: z.boolean().optional(), dead: z.boolean().optional() }).nullable();

class InvalidResponse extends Error {
  constructor() {
    super("The response did not match the API's shape");
    this.name = "InvalidResponse";
  }
}

const backoffFrom = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_BACKOFF_MS)
    : DEFAULT_BACKOFF_MS;
};

/**
 * A GET with the descriptive User-Agent, paced, backing off once on 429. Null when the source is
 * still rate limiting after the retry: the run stops with what it has.
 */
async function politeGet(
  ctx: CollectContext,
  url: string,
  first: boolean,
): Promise<Response | null> {
  if (!first) await ctx.sleep(PACE_MS);
  const get = () =>
    ctx.fetch(url, { headers: { "user-agent": ctx.userAgent, accept: "application/json" } });
  let response = await get();
  if (response.status === 429) {
    await ctx.sleep(backoffFrom(response));
    response = await get();
    if (response.status === 429) return null;
  }
  if (!response.ok)
    throw Object.assign(new Error("HTTP error"), { name: `Http${response.status}` });
  return response;
}

function toPost(hit: z.infer<typeof Hit>, termId: string): CollectedPost {
  const text = hit.comment_text
    ? htmlToText(hit.comment_text)
    : [hit.title ?? "", htmlToText(hit.story_text ?? "")].filter(Boolean).join(" ");
  return {
    externalId: hit.objectID,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    excerpt: toExcerpt(text),
    postedAt: new Date(hit.created_at_i * 1000),
    authorKey: hit.author,
    community: "Hacker News",
    termId,
    nsfw: false,
  };
}

async function start(ctx: CollectContext): Promise<RunState> {
  const posts = new Map<string, CollectedPost>();
  const since = Math.floor(ctx.since.getTime() / 1000);
  let units = 0;
  let requests = 0;
  try {
    for (const [index, term] of ctx.terms.entries()) {
      const remaining = ctx.budget - units;
      if (remaining <= 0) break;
      const perTerm = Math.min(
        MAX_PER_TERM,
        remaining,
        Math.max(1, Math.ceil(remaining / (ctx.terms.length - index))),
      );
      const params = new URLSearchParams({
        query: term.term,
        tags: "(story,comment)",
        numericFilters: `created_at_i>${since}`,
        hitsPerPage: String(perTerm),
      });
      const response = await politeGet(ctx, `${SEARCH_URL}?${params}`, requests++ === 0);
      if (!response) break;
      const parsed = SearchResponse.safeParse(await response.json());
      if (!parsed.success) throw new InvalidResponse();
      const raw = parsed.data.hits.slice(0, perTerm);
      units += raw.length;
      const hits = raw.flatMap((item) => {
        const hit = Hit.safeParse(item);
        return hit.success ? [hit.data] : [];
      });
      // Every hit malformed means the shape changed: fail loudly rather than return nothing.
      if (raw.length > 0 && hits.length === 0) throw new InvalidResponse();
      for (const hit of hits) {
        if (hit.created_at_i <= since || posts.has(hit.objectID)) continue;
        const post = toPost(hit, term.id);
        if (post.excerpt) posts.set(hit.objectID, post);
      }
    }
  } catch (error) {
    return { kind: "failed", errorClass: error instanceof Error ? error.name : "Error" };
  }
  return { kind: "done", posts: [...posts.values()], units };
}

async function checkDeleted(
  ctx: CollectContext,
  externalIds: readonly string[],
): Promise<string[]> {
  const gone: string[] = [];
  let requests = 0;
  for (const id of externalIds) {
    if (!/^\d+$/.test(id)) continue;
    const response = await politeGet(ctx, `${ITEM_URL}/${id}.json`, requests++ === 0);
    if (!response) break;
    const parsed = Item.safeParse(await response.json());
    if (!parsed.success) throw new InvalidResponse();
    if (parsed.data === null || parsed.data.deleted || parsed.data.dead) gone.push(id);
  }
  return gone;
}

export const hackernews: CollectSource = {
  id: "hackernews",
  displayName: "Hacker News",
  mode: "collect",
  access: "official_api",
  termsUrl: "https://www.ycombinator.com/legal/",
  allowedHosts: ["hn.algolia.com", "hacker-news.firebaseio.com"],
  linkHosts: ["news.ycombinator.com"],
  dailyBudget: 300,
  retentionDays: 30,
  costPerUnitUsd: 0,
  credentials: [],
  start,
  checkDeleted,
};

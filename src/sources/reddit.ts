import { z } from "zod";
import { brightdataProvider, PINNED_DATASET_IDS } from "./reddit-brightdata";
import type { RedditProvider, RedditRecord } from "./reddit-provider";
import { BRIGHTDATA_API_HOST } from "./reddit-vendor";
import { isProfileCommunity, isSensitiveCommunity } from "./sensitive-communities";
import { toExcerpt } from "./text";
import type { CollectContext, CollectedPost, CollectSource, RunState } from "./types";

/**
 * Reddit (docs/PLAN.md 7.7, D1): public posts through the contracted data vendor's API, never from
 * reddit.com. The provider (Bright Data, src/sources/reddit-brightdata.ts) runs the search; this
 * module chooses the queries and drops, before anything leaves it: error records, NSFW posts,
 * posts from private, quarantined or unrecognized community types, deleted authors, posts whose
 * title or body was deleted or removed at the source, profile posts, posts from sensitive
 * communities (2.3.7), links that are not a Reddit post, and posts outside the window. Posts only,
 * never comments.
 */

const PROVIDERS: Readonly<Record<string, RedditProvider>> = { brightdata: brightdataProvider };

/** At most 12 terms a run, 5 to 20 posts each (docs/PLAN.md 7.3 step 2). */
export const MAX_TERMS = 12;
export const MIN_PER_TERM = 5;
export const MAX_PER_TERM = 20;

const HOUR = 60 * 60_000;
const REDDIT_WEB_HOSTS = new Set(["www.reddit.com", "old.reddit.com", "reddit.com"]);
/** A post's path: /r/<community>/comments/<id>/<optional slug>/ */
const POST_PATH = /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([A-Za-z0-9]{1,12})(?:\/[^/]*)?\/?$/;
const POST_ID = /^[A-Za-z0-9_]{1,40}$/;
/** Reddit's markers for a deleted or removed author, title or body: "[deleted]", "[removed by moderator]". */
const GONE_MARKER = /^\[(?:deleted|removed)(?: by [a-z ]{1,30})?\]$/i;
const isGone = (text: string) => GONE_MARKER.test(text.trim());

/** What start() hands to poll(): the provider, its handle, and which keyword is which term. */
const Handle = z.object({
  p: z.string().max(40),
  h: z.string().min(1).max(200),
  t: z
    .array(z.tuple([z.string().max(100), z.string().max(200)]))
    .max(MAX_TERMS)
    .default([]),
});

const named = (name: string) => Object.assign(new Error(name), { name });
const failed = (error: unknown): RunState => ({
  kind: "failed",
  errorClass: error instanceof Error ? error.name : "Error",
});

/** REDDIT_PROVIDER, "brightdata" when unset. Any other value refuses to start. */
function providerFor(ctx: CollectContext): RedditProvider {
  const id = ctx.credential("REDDIT_PROVIDER") || "brightdata";
  const provider = PROVIDERS[id];
  if (!provider) throw named("UnknownProvider");
  return provider;
}

/** The link as stored: https://www.reddit.com/r/<community>/comments/<id>/..., never fetched. */
function postLink(raw: string): { url: string; community: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  if (!REDDIT_WEB_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = POST_PATH.exec(url.pathname);
  if (!match) return null; // profile posts (/user/, /u/), galleries, wikis, anything else
  return { url: `https://www.reddit.com${url.pathname}`, community: match[1]! };
}

const stripPrefix = (name: string) => name.trim().replace(/^\/?r\//i, "");

function toPost(
  record: RedditRecord,
  ctx: CollectContext,
  termIds: ReadonlyMap<string, string>,
): CollectedPost | null {
  if (record.nsfw || record.restricted || !POST_ID.test(record.postId)) return null;
  const author = record.author?.trim() ?? "";
  if (!author || isGone(author)) return null;
  // A deleted or removed title or body means the post is gone at the source (2.3.6).
  if (isGone(record.title) || isGone(record.body)) return null;
  const link = postLink(record.url);
  if (!link) return null;
  // The community from the link and the one the provider names must both pass.
  const names = [link.community, ...(record.community ? [stripPrefix(record.community)] : [])];
  if (names.some((name) => isProfileCommunity(name) || isSensitiveCommunity(name))) return null;
  const posted = Date.parse(record.postedAt);
  if (Number.isNaN(posted) || posted <= ctx.since.getTime()) return null;
  const text = [record.title, record.body]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
  const excerpt = toExcerpt(text);
  if (!excerpt) return null;
  const keyword = record.keyword?.trim().toLowerCase() ?? "";
  return {
    externalId: record.postId,
    url: link.url,
    excerpt,
    postedAt: new Date(Math.min(posted, ctx.now.getTime())),
    authorKey: author,
    community: `r/${link.community}`,
    termId: termIds.get(keyword) ?? null,
    nsfw: false,
  };
}

async function start(ctx: CollectContext): Promise<RunState> {
  const count = Math.min(MAX_TERMS, ctx.terms.length, Math.floor(ctx.budget / MIN_PER_TERM));
  if (count <= 0) return { kind: "done", posts: [], units: 0 };
  const terms = ctx.terms.slice(0, count);
  const limit = Math.min(MAX_PER_TERM, Math.floor(ctx.budget / count));
  const windowHours = Math.max(1, Math.ceil((ctx.now.getTime() - ctx.since.getTime()) / HOUR));
  try {
    const provider = providerFor(ctx);
    const handle = await provider.start(
      ctx,
      terms.map((t) => ({ keyword: t.term, limit, windowHours })),
    );
    const state: z.input<typeof Handle> = {
      p: provider.id,
      h: handle,
      t: terms.map((t) => [t.id, t.term]),
    };
    return { kind: "pending", handle: JSON.stringify(state) };
  } catch (error) {
    return failed(error);
  }
}

async function poll(ctx: CollectContext, raw: string): Promise<RunState> {
  try {
    let parsed: z.infer<typeof Handle>;
    try {
      parsed = Handle.parse(JSON.parse(raw));
    } catch {
      throw named("InvalidHandle");
    }
    const provider = PROVIDERS[parsed.p];
    if (!provider) throw named("UnknownProvider");
    const run = await provider.collect(ctx, parsed.h);
    if (run.kind === "pending") return { kind: "pending", handle: raw };
    const termIds = new Map(parsed.t.map(([id, term]) => [term.trim().toLowerCase(), id]));
    const posts = new Map<string, CollectedPost>();
    for (const record of run.records) {
      const post = toPost(record, ctx, termIds);
      if (post && !posts.has(post.externalId)) posts.set(post.externalId, post);
    }
    return { kind: "done", posts: [...posts.values()], units: run.units };
  } catch (error) {
    return failed(error);
  }
}

/** A post the re-check found intact: a record with its author and its text still there. */
function isLive(record: RedditRecord): boolean {
  const author = record.author?.trim() ?? "";
  if (!author || isGone(author) || isGone(record.title) || isGone(record.body)) return false;
  return [record.title, record.body].some((part) => part.trim() !== "");
}

/**
 * The deletion re-check (docs/PLAN.md 2.3.6, 7.7): stored links re-collected once by URL through
 * the pinned dataset. Only posts that come back intact are live; an error record (a dead page), a
 * missing record, or a deleted author or removed text means the post is deleted here, the safe side
 * when the vendor cannot say.
 */
const recheck: NonNullable<CollectSource["recheck"]> = {
  enabled: (ctx) => ctx.credential("REDDIT_DELETION_RECHECK") !== "false",

  async start(ctx, urls) {
    try {
      return { kind: "pending", handle: await providerFor(ctx).startByUrl(ctx, urls) };
    } catch (error) {
      return { kind: "failed", errorClass: error instanceof Error ? error.name : "Error" };
    }
  },

  async poll(ctx, handle) {
    try {
      const run = await providerFor(ctx).collect(ctx, handle);
      if (run.kind === "pending") return { kind: "pending" };
      const live = [...new Set(run.records.filter(isLive).map((r) => r.postId))];
      return { kind: "done", live, units: run.units };
    } catch (error) {
      return { kind: "failed", errorClass: error instanceof Error ? error.name : "Error" };
    }
  },
};

export const reddit: CollectSource = {
  id: "reddit",
  displayName: "Reddit",
  mode: "collect",
  access: "vendor_api",
  vendor: {
    name: "Bright Data",
    dpaUrl: "https://brightdata.com/legal",
    dpaSignedOnEnv: "BRIGHTDATA_DPA_SIGNED_ON",
    // F8: set from Bright Data's written answer (here or in the env var), then the notice states it
    // and Reddit may run.
    snapshotRetention: null,
    snapshotRetentionEnv: "BRIGHTDATA_SNAPSHOT_RETENTION",
  },
  termsUrl: "https://brightdata.com/legal",
  allowedHosts: [BRIGHTDATA_API_HOST],
  linkHosts: ["www.reddit.com", "old.reddit.com"],
  dailyBudget: 120,
  retentionDays: 7,
  // $1.50 per 1,000 records (docs/PLAN.md 7.7); the founder confirms their rate (F8).
  costPerUnitUsd: 1.5 / 1000,
  credentials: [
    "REDDIT_PROVIDER",
    "REDDIT_DELETION_RECHECK",
    "BRIGHTDATA_API_TOKEN",
    "BRIGHTDATA_REDDIT_DATASET_ID",
  ],
  requiredCredentials: ["BRIGHTDATA_API_TOKEN", "BRIGHTDATA_REDDIT_DATASET_ID"],
  configProblems: (read) => {
    const problems: string[] = [];
    if (!PROVIDERS[read("REDDIT_PROVIDER") || "brightdata"])
      problems.push("REDDIT_PROVIDER names no known provider");
    const dataset = read("BRIGHTDATA_REDDIT_DATASET_ID");
    if (dataset && !PINNED_DATASET_IDS.includes(dataset))
      problems.push("BRIGHTDATA_REDDIT_DATASET_ID is not a pinned dataset id");
    return problems;
  },
  start,
  poll,
  recheck,
};

import { z } from "zod";
import { brightdataProvider } from "./reddit-brightdata";
import type { RedditProvider, RedditRecord } from "./reddit-provider";
import { BRIGHTDATA_API_HOST } from "./reddit-vendor";
import { isProfileCommunity, isSensitiveCommunity } from "./sensitive-communities";
import { toExcerpt } from "./text";
import type { CollectContext, CollectedPost, CollectSource, RunState } from "./types";

/**
 * Reddit (docs/PLAN.md 7.7, D1): public posts through the contracted data vendor's API, never from
 * reddit.com. The provider (Bright Data, src/sources/reddit-brightdata.ts) runs the search; this
 * module chooses the queries and drops, before anything leaves it: error records, NSFW posts,
 * deleted authors, profile posts, posts from sensitive communities (2.3.7), links that are not a
 * Reddit post, and posts outside the window. Posts only, never comments.
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
const GONE = new Set(["[deleted]", "[removed]"]);

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
  if (record.nsfw || !POST_ID.test(record.postId)) return null;
  const author = record.author?.trim() ?? "";
  if (!author || GONE.has(author.toLowerCase())) return null;
  const link = postLink(record.url);
  if (!link) return null;
  // The community from the link and the one the provider names must both pass.
  const names = [link.community, ...(record.community ? [stripPrefix(record.community)] : [])];
  if (names.some((name) => isProfileCommunity(name) || isSensitiveCommunity(name))) return null;
  const posted = Date.parse(record.postedAt);
  if (Number.isNaN(posted) || posted <= ctx.since.getTime()) return null;
  const text = [record.title, record.body]
    .map((part) => part.trim())
    .filter((part) => part && !GONE.has(part.toLowerCase()))
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

export const reddit: CollectSource = {
  id: "reddit",
  displayName: "Reddit",
  mode: "collect",
  access: "vendor_api",
  vendor: { name: "Bright Data", dpaUrl: "https://brightdata.com/legal" },
  termsUrl: "https://brightdata.com/legal",
  allowedHosts: [BRIGHTDATA_API_HOST],
  linkHosts: ["www.reddit.com", "old.reddit.com"],
  dailyBudget: 120,
  retentionDays: 7,
  // $1.50 per 1,000 records (docs/PLAN.md 7.7); the founder confirms their rate (F8).
  costPerUnitUsd: 1.5 / 1000,
  start,
  poll,
};

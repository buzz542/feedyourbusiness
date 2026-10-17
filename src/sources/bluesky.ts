import { z } from "zod";
import { toExcerpt } from "./text";
import type { CollectContext, CollectedPost, CollectSource, RunState } from "./types";

/**
 * Bluesky (docs/PLAN.md 7.5): official and free, through authenticated XRPC from AskedFor's own
 * account (an app password, F7). Read-only: one createSession, then searchPosts and getPosts. No
 * likes, follows, posts or messages, ever.
 *
 * Checked 17 Oct 2026 against the official lexicons (github.com/bluesky-social/atproto, commit
 * 9f66a7e; app.bsky lexicons as published in packages/api/lexicons):
 * - com.atproto.server.createSession takes identifier and password, returns accessJwt and did.
 * - app.bsky.feed.searchPosts: q (required), sort ("latest" is the default), since (inclusive,
 *   matched on the post's sort time), limit 1 to 100. Output: posts, an array of postView.
 * - app.bsky.feed.getPosts: uris, at most 25. Output: posts.
 * - Label values: porn, sexual, nudity and graphic-media are adult content; !hide is a moderation
 *   hide; !no-unauthenticated is the author asking not to be shown to logged-out viewers. AskedFor
 *   shows posts outside Bluesky, so both are dropped.
 * - record.createdAt is client-declared, so the posted time is the earlier of it and indexedAt.
 * Not yet checked: which host serves an authenticated account's reads (this module uses the entryway
 * bsky.social only, never a wildcard PDS host) and the session rate limit. docs.bsky.app could not be
 * reached from the build session, so both are a founder step before this source is switched on
 * (docs/TASKS.md M3).
 */

const XRPC = "https://bsky.social/xrpc";
const PACE_MS = 500;
const MAX_PER_TERM = 100;
const LOOKUP_BATCH = 25;
const DEFAULT_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 10_000;
/** Labels that mark a post as adult content (dropped as NSFW). */
const ADULT_LABELS = new Set(["porn", "sexual", "nudity", "graphic-media"]);
/** Labels on a post or its author that mean it is never shown outside Bluesky. */
const HIDDEN_LABELS = new Set(["!hide", "!no-unauthenticated"]);

const DID = /^did:(plc|web):[A-Za-z0-9._:%-]+$/;
const POST_URI =
  /^at:\/\/(did:(?:plc|web):[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]{1,512})$/;

const Session = z.object({ accessJwt: z.string().min(1), did: z.string().regex(DID) });
const Label = z.object({ val: z.string() });
const PostView = z.object({
  uri: z.string().regex(POST_URI),
  author: z.object({ did: z.string().regex(DID), labels: z.array(Label).optional() }),
  record: z.object({
    text: z.string(),
    createdAt: z.string(),
    labels: z.object({ values: z.array(Label) }).optional(),
  }),
  indexedAt: z.string(),
  labels: z.array(Label).optional(),
});
const SearchResponse = z.object({ posts: z.array(PostView) });
const GetPostsResponse = z.object({ posts: z.array(z.object({ uri: z.string() })) });

class InvalidResponse extends Error {
  constructor() {
    super("The response did not match the API's shape");
    this.name = "InvalidResponse";
  }
}
class MissingCredentials extends Error {
  constructor() {
    super("BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD are not set");
    this.name = "MissingCredentials";
  }
}

/**
 * One session per function invocation, reused across jobs (Bluesky limits how often an account
 * may create sessions). Kept until shortly before the access token expires.
 */
let session: { accessJwt: string; expiresAt: number } | null = null;

/** Tests only: forget the cached session. */
export function resetBlueskySession(): void {
  session = null;
}

function expiryOf(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // Not a readable JWT: fall back below.
  }
  return Date.now() + 30 * 60_000;
}

async function accessToken(ctx: CollectContext): Promise<string> {
  const now = ctx.now.getTime();
  if (session && session.expiresAt - 60_000 > now) return session.accessJwt;
  const identifier = ctx.credential("BLUESKY_IDENTIFIER");
  const password = ctx.credential("BLUESKY_APP_PASSWORD");
  if (!identifier || !password) throw new MissingCredentials();
  const response = await ctx.fetch(`${XRPC}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ctx.userAgent },
    body: JSON.stringify({ identifier, password }),
  });
  if (!response.ok)
    throw Object.assign(new Error("Session refused"), { name: `Http${response.status}` });
  const parsed = Session.safeParse(await response.json());
  if (!parsed.success) throw new InvalidResponse();
  session = { accessJwt: parsed.data.accessJwt, expiresAt: expiryOf(parsed.data.accessJwt) };
  return session.accessJwt;
}

const backoffFrom = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_BACKOFF_MS)
    : DEFAULT_BACKOFF_MS;
};

/** An authenticated GET, paced, backing off once on 429; null when still rate limited. */
async function xrpcGet(
  ctx: CollectContext,
  token: string,
  url: string,
  first: boolean,
): Promise<Response | null> {
  if (!first) await ctx.sleep(PACE_MS);
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
    if (response.status === 429) return null;
  }
  if (!response.ok)
    throw Object.assign(new Error("HTTP error"), { name: `Http${response.status}` });
  return response;
}

function toPost(view: z.infer<typeof PostView>, termId: string): CollectedPost | null {
  const match = POST_URI.exec(view.uri);
  if (!match) return null;
  const [, did, rkey] = match;
  if (did !== view.author.did) return null;
  const labels = [
    ...(view.labels ?? []),
    ...(view.record.labels?.values ?? []),
    ...(view.author.labels ?? []),
  ].map((l) => l.val);
  if (labels.some((label) => HIDDEN_LABELS.has(label))) return null;
  const created = Date.parse(view.record.createdAt);
  const indexed = Date.parse(view.indexedAt);
  if (Number.isNaN(created) && Number.isNaN(indexed)) return null;
  // createdAt is client-declared: never later than when Bluesky indexed the post.
  const postedAt = new Date(
    Number.isNaN(indexed) ? created : Number.isNaN(created) ? indexed : Math.min(created, indexed),
  );
  return {
    externalId: view.uri,
    // The DID, never the handle (a DID is the stable public id; the privacy notice says so).
    url: `https://bsky.app/profile/${did}/post/${rkey}`,
    excerpt: toExcerpt(view.record.text),
    postedAt,
    authorKey: view.author.did,
    community: "Bluesky",
    termId,
    nsfw: labels.some((label) => ADULT_LABELS.has(label)),
  };
}

async function start(ctx: CollectContext): Promise<RunState> {
  if (ctx.budget <= 0 || ctx.terms.length === 0) return { kind: "done", posts: [], units: 0 };
  const posts = new Map<string, CollectedPost>();
  let units = 0;
  try {
    const token = await accessToken(ctx);
    let first = true;
    for (const [index, term] of ctx.terms.entries()) {
      const remaining = ctx.budget - units;
      if (remaining <= 0) break;
      const limit = Math.min(
        MAX_PER_TERM,
        remaining,
        Math.max(1, Math.ceil(remaining / (ctx.terms.length - index))),
      );
      const params = new URLSearchParams({
        q: term.term,
        sort: "latest",
        since: ctx.since.toISOString(),
        limit: String(limit),
      });
      const response = await xrpcGet(
        ctx,
        token,
        `${XRPC}/app.bsky.feed.searchPosts?${params}`,
        first,
      );
      first = false;
      if (!response) break;
      const parsed = SearchResponse.safeParse(await response.json());
      if (!parsed.success) throw new InvalidResponse();
      const views = parsed.data.posts.slice(0, limit);
      units += views.length;
      for (const view of views) {
        if (posts.has(view.uri)) continue;
        const post = toPost(view, term.id);
        if (post && post.postedAt > ctx.since && post.excerpt) posts.set(view.uri, post);
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
  const uris = externalIds.filter((id) => POST_URI.test(id));
  if (uris.length === 0) return [];
  const token = await accessToken(ctx);
  const gone: string[] = [];
  for (let i = 0; i < uris.length; i += LOOKUP_BATCH) {
    const batch = uris.slice(i, i + LOOKUP_BATCH);
    const params = new URLSearchParams();
    for (const uri of batch) params.append("uris", uri);
    const response = await xrpcGet(ctx, token, `${XRPC}/app.bsky.feed.getPosts?${params}`, i === 0);
    if (!response) break;
    const parsed = GetPostsResponse.safeParse(await response.json());
    if (!parsed.success) throw new InvalidResponse();
    const found = new Set(parsed.data.posts.map((p) => p.uri));
    gone.push(...batch.filter((uri) => !found.has(uri)));
  }
  return gone;
}

export const bluesky: CollectSource = {
  id: "bluesky",
  displayName: "Bluesky",
  mode: "collect",
  access: "official_api",
  termsUrl: "https://bsky.social/about/support/tos",
  allowedHosts: ["bsky.social"],
  linkHosts: ["bsky.app"],
  dailyBudget: 300,
  retentionDays: 30,
  costPerUnitUsd: 0,
  start,
  checkDeleted,
};

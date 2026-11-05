import { z } from "zod";

/**
 * Remove my post (docs/PLAN.md 4.8, 2.3.5, 12.5). A person gives a link to a post or their username
 * on a source; the admin's one click finds the author hash we would have stored, deletes their
 * posts, suppresses the hash so it is never stored again, closes the request, writes the audit log
 * and emails them. Usernames are hashed exactly as collection hashes them: Reddit and Hacker News
 * by name; Bluesky by the DID its handle resolves to; X by the user id its username resolves to.
 */

export const REMOVAL_SOURCES = ["reddit", "hackernews", "bluesky", "x"] as const;
export type RemovalSource = (typeof REMOVAL_SOURCES)[number];
export const REMOVAL_DAILY_LIMIT = 5;

export type RemovalTarget =
  | { kind: "post"; source: RemovalSource; externalId: string }
  /** A Bluesky post link that names a handle, not a DID: resolve, then it is a post. */
  | { kind: "bluesky_post_by_handle"; handle: string; rkey: string }
  | { kind: "author"; source: RemovalSource; key: string };

const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"]);
const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const DID = /^did:(plc|web):[A-Za-z0-9._:%-]+$/;

/** A link or a username, with the source the person picked. Null when we cannot use it. */
export function parseRemovalTarget(input: string, source: RemovalSource): RemovalTarget | null {
  const text = input.trim();
  if (!text || text.length > 500) return null;
  if (/^https?:\/\//i.test(text)) return parseLink(text, source);
  const key = text.replace(/^@/, "").replace(/^\/?u\//i, "");
  if (!/^[A-Za-z0-9._:-]{1,253}$/.test(key)) return null;
  return { kind: "author", source, key };
}

function parseLink(text: string, source: RemovalSource): RemovalTarget | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (source === "hackernews" && host === "news.ycombinator.com") {
    const id = url.searchParams.get("id");
    return id && /^\d{1,12}$/.test(id) ? { kind: "post", source, externalId: id } : null;
  }
  if (source === "reddit" && REDDIT_HOSTS.has(host)) {
    // /r/<sub>/comments/<id>/... ; a profile link /user/<name> or /u/<name> names the author.
    const at = parts.indexOf("comments");
    if (at >= 0 && parts[at + 1] && /^[a-z0-9]{1,12}$/i.test(parts[at + 1]!))
      return { kind: "post", source, externalId: parts[at + 1]!.toLowerCase() };
    if ((parts[0] === "user" || parts[0] === "u") && parts[1])
      return parseRemovalTarget(parts[1], source);
    return null;
  }
  if (source === "bluesky" && host === "bsky.app" && parts[0] === "profile" && parts[1]) {
    const who = decodeURIComponent(parts[1]);
    if (parts[2] === "post" && parts[3]) {
      if (DID.test(who))
        return {
          kind: "post",
          source,
          externalId: `at://${who}/app.bsky.feed.post/${parts[3]}`,
        };
      return { kind: "bluesky_post_by_handle", handle: who, rkey: parts[3] };
    }
    return { kind: "author", source, key: who };
  }
  if (source === "x" && X_HOSTS.has(host)) {
    const at = parts.indexOf("status");
    if (at >= 0 && parts[at + 1] && /^\d{1,20}$/.test(parts[at + 1]!))
      return { kind: "post", source, externalId: parts[at + 1]! };
    if (parts.length === 1) return parseRemovalTarget(parts[0]!, source);
    return null;
  }
  return null;
}

export const RemovalForm = z.object({
  source: z.enum(REMOVAL_SOURCES),
  linkOrHandle: z.string().trim().min(1).max(500),
  contactEmail: z.email().max(320),
  details: z.string().trim().max(1000).optional().default(""),
  confirm: z.literal(true),
});
export type RemovalFormInput = z.infer<typeof RemovalForm>;

export interface RemovalRequest {
  id: string;
  source: RemovalSource | null;
  linkOrHandle: string;
  contactEmail: string;
}

export interface RemovalDeps {
  /** The stored author hash of a post, or null when we never stored it. */
  findPostAuthor(source: RemovalSource, externalId: string): Promise<string | null>;
  hash(source: RemovalSource, authorKey: string): string;
  /** Null when the handle does not resolve. Throws when the lookup itself fails. */
  resolveBlueskyHandle(handle: string): Promise<string | null>;
  /** Null when there is no such user. Throws when the lookup itself fails. */
  resolveXUsername(username: string): Promise<string | null>;
  removeAndSuppress(args: {
    requestId: string;
    source: RemovalSource;
    authorHash: string;
    externalId: string | null;
    actor: string;
    now: Date;
  }): Promise<number>;
  close(requestId: string, status: "closed" | "rejected", actor: string, now: Date): Promise<void>;
  sendDone(to: string, outcome: "removed" | "not_found"): Promise<void>;
  now(): Date;
}

export type RemovalOutcome =
  | { kind: "removed"; postsDeleted: number }
  /** Nothing we hold matches: the admin may close it; the requester is told. */
  | { kind: "not_found" }
  | { kind: "unreadable" };

/** The author hash a request points at, and the post it names, if any. */
export async function resolveRemoval(
  deps: Pick<RemovalDeps, "findPostAuthor" | "hash" | "resolveBlueskyHandle" | "resolveXUsername">,
  request: RemovalRequest,
): Promise<
  { authorHash: string; externalId: string | null; source: RemovalSource } | "unreadable" | null
> {
  if (!request.source) return "unreadable";
  let target = parseRemovalTarget(request.linkOrHandle, request.source);
  if (!target) return "unreadable";
  if (target.kind === "bluesky_post_by_handle") {
    const did = await deps.resolveBlueskyHandle(target.handle);
    if (!did) return null;
    target = {
      kind: "post",
      source: "bluesky",
      externalId: `at://${did}/app.bsky.feed.post/${target.rkey}`,
    };
  }
  if (target.kind === "post") {
    const authorHash = await deps.findPostAuthor(target.source, target.externalId);
    return authorHash ? { authorHash, externalId: target.externalId, source: target.source } : null;
  }
  // A username: hashed from the same stable id collection hashes.
  let key: string | null = target.key;
  if (target.source === "bluesky" && !DID.test(target.key))
    key = await deps.resolveBlueskyHandle(target.key);
  if (target.source === "x" && !/^\d{1,20}$/.test(target.key))
    key = await deps.resolveXUsername(target.key);
  if (!key) return null;
  return { authorHash: deps.hash(target.source, key), externalId: null, source: target.source };
}

/** The admin's one click: "Delete and suppress". */
export async function handleRemoval(
  deps: RemovalDeps,
  request: RemovalRequest,
  actor: string,
): Promise<RemovalOutcome> {
  const resolved = await resolveRemoval(deps, request);
  if (resolved === "unreadable") return { kind: "unreadable" };
  if (!resolved) return { kind: "not_found" };
  const postsDeleted = await deps.removeAndSuppress({
    requestId: request.id,
    source: resolved.source,
    authorHash: resolved.authorHash,
    externalId: resolved.externalId,
    actor,
    now: deps.now(),
  });
  await deps.sendDone(request.contactEmail, "removed");
  return { kind: "removed", postsDeleted };
}

/** Close a request we hold nothing for, telling the requester. */
export async function closeRemoval(
  deps: Pick<RemovalDeps, "close" | "sendDone" | "now">,
  request: RemovalRequest,
  actor: string,
): Promise<void> {
  await deps.close(request.id, "closed", actor, deps.now());
  await deps.sendDone(request.contactEmail, "not_found");
}

import { z } from "zod";

/**
 * Remove my post (docs/PLAN.md 2.3.5, 4.8, 12.7). Anyone can ask; 5 requests per IP hash per day.
 * An admin's one click deletes the matching posts, adds the author hash to the suppression list
 * (so the account is never stored again), closes the request, emails the requester and writes the
 * audit log. A post link is matched to the stored post and suppresses that post's author; a
 * username is hashed as the source hashes it, after a Bluesky handle is resolved to its DID and an
 * X username to its user id, because those sources key authors by the stable id.
 */

export const SOURCES = ["reddit", "hackernews", "bluesky", "x"] as const;
export type RemovalSource = (typeof SOURCES)[number];
export const DAILY_LIMIT = 5;

export const RemovalInput = z.object({
  link_or_handle: z.string().trim().min(2).max(500),
  source: z.enum(SOURCES).nullable().optional(),
  contact_email: z.email().max(320),
  details: z.string().trim().max(1000).optional().default(""),
});
export type RemovalInput = z.infer<typeof RemovalInput>;

export interface RemovalStore {
  countSince(ipHash: string, since: Date): Promise<number>;
  insert(row: {
    link_or_handle: string;
    source: RemovalSource | null;
    contact_email: string;
    details: string | null;
    ip_hash: string;
  }): Promise<string>;
}

export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid" | "rate_limited"; errors?: Record<string, string> };

export async function submitRemoval(
  deps: { store: RemovalStore; notify?: (to: string) => Promise<void> },
  raw: unknown,
  ipHash: string,
  now: Date,
): Promise<SubmitResult> {
  const parsed = RemovalInput.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      errors[field] ??=
        field === "contact_email"
          ? "Enter an email address we can reply to."
          : field === "link_or_handle"
            ? "Enter the link to the post or the username."
            : "Check this field.";
    }
    return { ok: false, reason: "invalid", errors };
  }
  const since = new Date(now.getTime() - 24 * 3_600_000);
  if ((await deps.store.countSince(ipHash, since)) >= DAILY_LIMIT)
    return { ok: false, reason: "rate_limited" };
  const input = parsed.data;
  const id = await deps.store.insert({
    link_or_handle: input.link_or_handle,
    source: input.source ?? null,
    contact_email: input.contact_email,
    details: input.details || null,
    ip_hash: ipHash,
  });
  await deps.notify?.(input.contact_email).catch(() => undefined);
  return { ok: true, id };
}

/** What a request points at: a post by its stored link, or an author by name on a source. */
export type RemovalTarget =
  | { kind: "post"; source: RemovalSource; urls: string[] }
  | { kind: "author"; source: RemovalSource; name: string }
  | { kind: "unknown" };

const HANDLE = /^@?[\p{L}\p{N}_.-]{1,100}$/u;

/** The stored forms of a post link (we store one canonical URL per source). */
export function targetOf(linkOrHandle: string, source: RemovalSource | null): RemovalTarget {
  const raw = linkOrHandle.trim();
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (url && url.protocol === "https:") {
    const host = url.hostname.toLowerCase().replace(/^m\./, "www.");
    if (host === "news.ycombinator.com") {
      const id = url.searchParams.get("id");
      if (id && /^\d+$/.test(id))
        return {
          kind: "post",
          source: "hackernews",
          urls: [`https://news.ycombinator.com/item?id=${id}`],
        };
    }
    if (host === "www.reddit.com" || host === "old.reddit.com" || host === "reddit.com") {
      const path = url.pathname.replace(/\/+$/, "");
      return {
        kind: "post",
        source: "reddit",
        urls: [`https://www.reddit.com${path}/`, `https://www.reddit.com${path}`],
      };
    }
    if (
      host === "x.com" ||
      host === "twitter.com" ||
      host === "www.x.com" ||
      host === "www.twitter.com"
    ) {
      const id = /\/status\/(\d{1,20})/.exec(url.pathname)?.[1];
      if (id) return { kind: "post", source: "x", urls: [`https://x.com/i/web/status/${id}`] };
    }
    if (host === "bsky.app") {
      const m = /^\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)/.exec(url.pathname);
      if (m)
        return {
          kind: "post",
          source: "bluesky",
          urls: [`https://bsky.app/profile/${m[1]}/post/${m[2]}`],
        };
    }
    return { kind: "unknown" };
  }
  const name = raw.replace(/^\/?u\//i, "");
  if (source && HANDLE.test(name)) return { kind: "author", source, name: name.replace(/^@/, "") };
  return { kind: "unknown" };
}

export interface RemovalAdminDeps {
  load(id: string): Promise<{
    id: string;
    link_or_handle: string;
    source: RemovalSource | null;
    contact_email: string;
    status: string;
  } | null>;
  /** The author hash of a stored post with one of these links on this source. */
  authorOfPost(source: RemovalSource, urls: readonly string[]): Promise<string | null>;
  /**
   * For a link whose post is no longer stored: the author's key from the source itself (the
   * Hacker News item's author, the DID in a Bluesky link), or null where that is not possible.
   */
  authorKeyOfLink?(source: RemovalSource, url: string): Promise<string | null>;
  /** A Bluesky handle's DID, an X username's user id; the name itself for other sources. */
  stableId(source: RemovalSource, name: string): Promise<string | null>;
  hash(source: RemovalSource, key: string): string;
  suppress(authorHash: string, source: RemovalSource, reason: string): Promise<void>;
  deletePosts(authorHash: string, source: RemovalSource): Promise<number>;
  close(id: string, status: "removed" | "rejected", now: Date): Promise<void>;
  audit(entry: { actor: string; action: string; target: string }): Promise<void>;
  notify(to: string, outcome: "removed" | "not_found"): Promise<void>;
}

export type HandleResult =
  | { ok: true; deleted: number; suppressed: boolean }
  | { ok: false; reason: "not_found" | "closed" };

/** The admin's one click: delete and suppress (docs/PLAN.md 4.8). */
export async function deleteAndSuppress(
  deps: RemovalAdminDeps,
  requestId: string,
  adminId: string,
  now: Date,
): Promise<HandleResult> {
  const request = await deps.load(requestId);
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "received" && request.status !== "verified")
    return { ok: false, reason: "closed" };
  const target = targetOf(request.link_or_handle, request.source);
  let authorHash: string | null = null;
  let source: RemovalSource | null = null;
  if (target.kind === "post") {
    source = target.source;
    authorHash = await deps.authorOfPost(target.source, target.urls);
    if (!authorHash && deps.authorKeyOfLink) {
      const key = await deps.authorKeyOfLink(target.source, target.urls[0]!).catch(() => null);
      authorHash = key ? deps.hash(target.source, key) : null;
    }
  } else if (target.kind === "author") {
    source = target.source;
    const id = await deps.stableId(target.source, target.name);
    authorHash = id ? deps.hash(target.source, id) : null;
  }
  let deleted = 0;
  if (authorHash && source) {
    await deps.suppress(authorHash, source, "removal_request");
    deleted = await deps.deletePosts(authorHash, source);
  }
  await deps.close(requestId, authorHash ? "removed" : "rejected", now);
  await deps.audit({
    actor: `admin:${adminId}`,
    action: authorHash ? "removal_delete_and_suppress" : "removal_not_matched",
    target: `removal_request:${requestId}`,
  });
  await deps
    .notify(request.contact_email, authorHash ? "removed" : "not_found")
    .catch(() => undefined);
  return { ok: true, deleted, suppressed: authorHash !== null };
}

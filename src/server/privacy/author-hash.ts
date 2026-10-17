import "server-only";
import { createHmac } from "node:crypto";
import type { CollectedPost } from "@/sources/types";

/**
 * Author hashing (docs/PLAN.md 12.5): HMAC-SHA256(AUTHOR_HASH_PEPPER, "<source>:<normalized key>"),
 * hex. The pepper never rotates: rotating it would orphan the suppression list. The raw author key
 * is hashed the moment a source returns it and never stored, logged or put in an error.
 */

type Env = Readonly<Record<string, string | undefined>>;

export type AuthorHasher = (source: string, authorKey: string) => string;

/** Trimmed, lowercased, without a leading "@", "u/" or "/u/". */
export function normalizeAuthorKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/^(@|\/?u\/)/, "");
}

export function authorHasher(env: Env = process.env): AuthorHasher {
  const pepper = env.AUTHOR_HASH_PEPPER;
  if (!pepper || pepper.length < 32)
    throw new Error("AUTHOR_HASH_PEPPER is missing or shorter than 32 characters");
  return (source, authorKey) =>
    createHmac("sha256", pepper)
      .update(`${source}:${normalizeAuthorKey(authorKey)}`)
      .digest("hex");
}

/** A collected post with its author key replaced by the hash. */
export type HashedPost = Omit<CollectedPost, "authorKey"> & { authorHash: string };

export function hashAuthors(
  source: string,
  posts: readonly CollectedPost[],
  hash: AuthorHasher,
): HashedPost[] {
  return posts.map(({ authorKey, ...post }) => ({ ...post, authorHash: hash(source, authorKey) }));
}

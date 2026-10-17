import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectedPost } from "@/sources/types";
import { authorHasher, hashAuthors, normalizeAuthorKey } from "./author-hash";

/** Author hashing (docs/PLAN.md 12.5): keyed, per source, and the raw key goes nowhere. */

const PEPPER = "p".repeat(32);
const hash = authorHasher({ AUTHOR_HASH_PEPPER: PEPPER });

afterEach(() => vi.restoreAllMocks());

describe("authorHasher", () => {
  it("is HMAC-SHA256 of '<source>:<normalized key>' with the pepper, in hex", () => {
    expect(hash("reddit", "Name")).toBe(
      createHmac("sha256", PEPPER).update("reddit:name").digest("hex"),
    );
    expect(hash("reddit", "Name")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes @Name, name and u/name the same within a source", () => {
    const forms = ["@Name", "name", "u/name", " NAME ", "/u/Name"].map((k) => hash("reddit", k));
    expect(new Set(forms).size).toBe(1);
  });

  it("hashes the same key differently across sources", () => {
    expect(hash("reddit", "name")).not.toBe(hash("hackernews", "name"));
    expect(hash("bluesky", "name")).not.toBe(hash("x", "name"));
  });

  it.each([
    ["missing", {}],
    ["empty", { AUTHOR_HASH_PEPPER: "" }],
    ["too short", { AUTHOR_HASH_PEPPER: "short" }],
  ])("throws when the pepper is %s", (_label, env) => {
    expect(() => authorHasher(env)).toThrow(/AUTHOR_HASH_PEPPER/);
  });

  it("normalizes only the leading marker", () => {
    expect(normalizeAuthorKey("@u/name")).toBe("u/name");
    expect(normalizeAuthorKey("name@host")).toBe("name@host");
  });
});

describe("hashAuthors", () => {
  const post = (authorKey: string): CollectedPost => ({
    externalId: "t3_1",
    url: "https://www.reddit.com/r/SaaS/comments/1/",
    excerpt: "Looking for an invoice tool",
    postedAt: new Date("2026-10-17T10:00:00Z"),
    authorKey,
    community: "r/SaaS",
    termId: null,
    nsfw: false,
  });

  it("swaps the author key for its hash, and the raw key reaches no store, log or error", () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const stored = hashAuthors("reddit", [post("SecretAuthor_42")], hash);
    expect(stored[0]).not.toHaveProperty("authorKey");
    expect(stored[0]!.authorHash).toBe(hash("reddit", "SecretAuthor_42"));
    expect(JSON.stringify(stored)).not.toMatch(/secretauthor_42/i);
    for (const log of logs) expect(log).not.toHaveBeenCalled();

    // A bad pepper fails without naming the key it was asked to hash.
    let message = "";
    try {
      hashAuthors("reddit", [post("SecretAuthor_42")], authorHasher({}));
    } catch (error) {
      message = String(error) + JSON.stringify(error);
    }
    expect(message).toMatch(/AUTHOR_HASH_PEPPER/);
    expect(message).not.toMatch(/secretauthor_42/i);
  });
});

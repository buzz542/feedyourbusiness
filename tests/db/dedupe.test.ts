import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Dedupe (docs/PLAN.md 7.3 steps 6 and 8, M4): the same post found by two terms, through two URL
 * forms, or for two products is one `posts` row, and one `product_posts` row per product, with the
 * statements the collect store sends (`ingest_post`, then an insert that does nothing on conflict).
 */

const LATEST = migrationNamed("classification");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const NOW = "2026-10-18T09:00:00Z";

let db: PGlite;
let alice = "";
let bob = "";

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0]!.n);

const ingest = (source: string, externalId: string, url: string) =>
  asService(async () => {
    const { rows } = await db.query<{ id: string }>(
      "select public.ingest_post($1, $2, $3, $4, $5, $6, $7, $8) as id",
      [
        source,
        externalId,
        url,
        "Looking for a tool that chases unpaid invoices.",
        "2026-10-18T07:00:00Z",
        "hash-author-1",
        source === "reddit" ? "r/freelance" : "Hacker News",
        NOW,
      ],
    );
    return rows[0]!.id;
  });

const link = (productId: string, postId: string) =>
  asService(() =>
    db.query(
      `insert into public.product_posts (product_id, post_id, relevance, category, reason)
       values ($1, $2, 70, 'looking_for_tool', 'Asks for a tool.')
       on conflict (product_id, post_id) do nothing`,
      [productId, postId],
    ),
  );

beforeAll(async () => {
  db = await createDb({ before: LATEST });
  await applyMigrationsFrom(db, LATEST);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  const product = async (owner: string, url: string) =>
    (
      await db.query<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, $2, 'P') returning id",
        [owner, url],
      )
    ).rows[0]!.id;
  alice = await product(ALICE, "https://alice.example.test");
  bob = await product(BOB, "https://bob.example.test");
});

beforeEach(async () => {
  await db.query("delete from public.product_posts");
  await db.query("delete from public.posts");
});

afterAll(async () => {
  await db.close();
});

describe("dedupe", () => {
  it("one post found by two terms is one row and one link", async () => {
    const url = "https://www.reddit.com/r/freelance/comments/1exa001/x/";
    const first = await ingest("reddit", "1exa001", url); // term "invoice reminders"
    const second = await ingest("reddit", "1exa001", url); // term "late fees"
    expect(second).toBe(first);
    await link(alice, first);
    await link(alice, second);
    expect(await count("select count(*)::int as n from public.posts")).toBe(1);
    expect(await count("select count(*)::int as n from public.product_posts")).toBe(1);
  });

  it("one post reached through two URL forms is one row, keeping the first link", async () => {
    const first = await ingest(
      "reddit",
      "1exa002",
      "https://www.reddit.com/r/freelance/comments/1exa002/late_fees/",
    );
    const second = await ingest(
      "reddit",
      "1exa002",
      "https://www.reddit.com/r/freelance/comments/1exa002/",
    );
    expect(second).toBe(first);
    expect((await db.query<{ url: string }>("select url from public.posts")).rows).toEqual([
      { url: "https://www.reddit.com/r/freelance/comments/1exa002/late_fees/" },
    ]);
  });

  it("one post matched by two products is one row and one link per product", async () => {
    const id = await ingest(
      "hackernews",
      "41000001",
      "https://news.ycombinator.com/item?id=41000001",
    );
    await link(alice, id);
    await link(bob, id);
    await link(
      alice,
      await ingest("hackernews", "41000001", "https://news.ycombinator.com/item?id=41000001"),
    );
    expect(await count("select count(*)::int as n from public.posts")).toBe(1);
    const links = await db.query<{ product_id: string }>(
      "select product_id from public.product_posts order by product_id",
    );
    expect(links.rows.map((r) => r.product_id).sort()).toEqual([alice, bob].sort());
  });

  it("keeps the same id from two sources apart: they are different posts", async () => {
    const reddit = await ingest("reddit", "1", "https://www.reddit.com/r/freelance/comments/1/");
    const hn = await ingest("hackernews", "1", "https://news.ycombinator.com/item?id=1");
    expect(hn).not.toBe(reddit);
    expect(await count("select count(*)::int as n from public.posts")).toBe(2);
  });
});

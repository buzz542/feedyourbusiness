import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `reddit_recheck` (docs/PLAN.md 2.3.6, 7.7): the Reddit posts due for their one-time
 * deletion re-check (collected in a past window), each attributed to the product that linked it
 * first, so a post shared by two products is re-checked, and paid for, once.
 */

const MIGRATION = migrationNamed("reddit_recheck");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;
let alice = "";
let bob = "";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const FROM = hoursAgo(96);
const TO = hoursAgo(72);

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;

async function post(source: string, externalId: string, collectedHoursAgo: number) {
  const days = source === "reddit" || source === "x" ? 7 : 30;
  const collected = hoursAgo(collectedHoursAgo);
  return (
    await one<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash, community)
       values ($1, $2, $3, 'An invented excerpt', $4, $4, $4::timestamptz + make_interval(days => $5), 'h', $6) returning id`,
      [
        source,
        externalId,
        source === "reddit"
          ? `https://www.reddit.com/r/SaaS/comments/${externalId}/x/`
          : `https://news.ycombinator.com/item?id=${externalId}`,
        collected,
        days,
        source === "reddit" ? "r/SaaS" : "Hacker News",
      ],
    )
  ).id;
}

async function link(product: string, postId: string, at: string) {
  await db.query(
    "insert into public.product_posts (product_id, post_id, relevance, category, reason, created_at) values ($1, $2, 70, 'wish', 'A wish.', $3)",
    [product, postId, at],
  );
}

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  const product = async (owner: string) =>
    (
      await one<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, 'https://p.example.test', 'P') returning id",
        [owner],
      )
    ).id;
  alice = await product(ALICE);
  bob = await product(BOB);

  const shared = await post("reddit", "shared1", 80); // alice linked it first, bob later
  await link(alice, shared, hoursAgo(80));
  await link(bob, shared, hoursAgo(79));
  await link(bob, await post("reddit", "bobonly", 85), hoursAgo(85));
  await link(alice, await post("reddit", "tooyoung", 50), hoursAgo(50)); // not due yet
  await link(alice, await post("reddit", "tooold", 100), hoursAgo(100)); // its window has passed
  await link(alice, await post("hackernews", "900", 80), hoursAgo(80)); // not Reddit
  await post("reddit", "orphan", 80); // linked to no product
});

afterAll(async () => {
  await db.close();
});

const products = () =>
  asService(async () =>
    (
      await db.query<{ id: string }>(
        "select id from public.reddit_recheck_products($1, $2) order by id",
        [FROM, TO],
      )
    ).rows.map((r) => r.id),
  );
const due = (product: string, limit = 100) =>
  asService(
    async () =>
      (
        await db.query<{ external_id: string; url: string }>(
          "select external_id, url from public.reddit_recheck_posts($1, $2, $3, $4)",
          [product, FROM, TO, limit],
        )
      ).rows,
  );

describe("reddit_recheck", () => {
  it("lists the products with Reddit posts due, by the product that linked each first", async () => {
    expect(await products()).toEqual([alice, bob].sort());
  });

  it("gives each product only the due posts it linked first", async () => {
    expect(await due(alice)).toEqual([
      { external_id: "shared1", url: "https://www.reddit.com/r/SaaS/comments/shared1/x/" },
    ]);
    expect((await due(bob)).map((r) => r.external_id)).toEqual(["bobonly"]);
  });

  it("respects the limit", async () => {
    expect(await due(alice, 0)).toEqual([]);
  });

  it("skips posts already past delete_after", async () => {
    await db.query(
      "update public.posts set delete_after = now() - interval '1 minute' where external_id = 'bobonly'",
    );
    expect(await due(bob)).toEqual([]);
  });

  it("is refused to anon and authenticated", async () => {
    for (const sql of [
      "select * from public.reddit_recheck_products(now(), now())",
      "select * from public.reddit_recheck_posts(gen_random_uuid(), now(), now(), 1)",
    ]) {
      await expect(withRole(db, "anon", null, () => db.query(sql))).rejects.toThrow(
        /permission denied for function/,
      );
      await expect(withRole(db, "authenticated", ALICE, () => db.query(sql))).rejects.toThrow(
        /permission denied for function/,
      );
    }
  });
});

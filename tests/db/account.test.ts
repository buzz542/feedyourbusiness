import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/**
 * Account deletion and export (docs/PLAN.md 10.6, 10.7, M8). Deleting the auth user with the admin
 * API cascades every owned row; what is kept holds no link to the person (llm_usage loses its
 * product, events lose their user). The export reads through the user's own client, so RLS alone
 * keeps every other account's rows out, even with no filter at all.
 */

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const DAY = 86_400_000;

let db: PGlite;
const ids = { alice: "", bob: "", alicePost: "", bobPost: "" };

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await one<{ n: number | string }>(sql, params)).n);

async function seed(owner: string, tag: string): Promise<{ product: string; post: string }> {
  const product = (
    await one<{ id: string }>(
      "insert into public.products (owner_id, url, name, status) values ($1, $2, $3, 'active') returning id",
      [owner, `https://${tag}.example.test`, `Product ${tag}`],
    )
  ).id;
  const term = (
    await one<{ id: string }>(
      "insert into public.search_terms (product_id, term) values ($1, $2) returning id",
      [product, `invoice tool for ${tag}`],
    )
  ).id;
  await db.query("insert into public.competitors (product_id, name) values ($1, $2)", [
    product,
    `Rival ${tag}`,
  ]);
  const post = await withRole(db, "service_role", null, async () => {
    const p = await one<{ id: string }>(
      "select public.ingest_post('hackernews', $1, $2, $3, $4, $5, null, $6) as id",
      [
        `ext-${tag}`,
        `https://news.ycombinator.com/item?id=${tag.length}${tag === "alice" ? 1 : 2}`,
        `Looking for an invoice tool, says ${tag}`,
        new Date(Date.now() - DAY).toISOString(),
        `hash-${tag}`,
        new Date().toISOString(),
      ],
    );
    await db.query(
      "insert into public.product_posts (product_id, post_id, relevance, category, reason, term_id) values ($1, $2, 80, 'looking_for_tool', 'Asks for a tool.', $3)",
      [product, p.id, term],
    );
    await db.query(
      "insert into public.term_stats (term_id, source, day, fetched, relevant) values ($1, 'hackernews', current_date, 3, 1)",
      [term],
    );
    await db.query(
      "insert into public.usage_ledger (product_id, source, reads) values ($1, 'hackernews', 3)",
      [product],
    );
    await db.query(
      "insert into public.jobs (kind, product_id, source, dedupe_key) values ('collect', $1, 'hackernews', $2)",
      [product, `collect:${product}:hackernews:today`],
    );
    await db.query(
      "insert into public.llm_usage (product_id, task, model, input_tokens, output_tokens, cost_usd) values ($1, 'draft', 'm', 10, 10, 0.01)",
      [product],
    );
    await db.query(
      "insert into public.llm_reservations (product_id, task, reserve_usd, created_at, expires_at) values ($1, 'draft', 0.01, now(), now() + interval '1 minute')",
      [product],
    );
    await db.query("insert into public.events (user_id, name) values ($1, 'feed_opened')", [owner]);
    return p.id;
  });
  return { product, post };
}

beforeAll(async () => {
  db = await createDb();
  await db.query(
    "insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')",
    [ALICE, BOB],
  );
  const a = await seed(ALICE, "alice");
  const b = await seed(BOB, "bob");
  ids.alice = a.product;
  ids.bob = b.product;
  ids.alicePost = a.post;
  ids.bobPost = b.post;
});

afterAll(async () => db?.close());

describe("export reads (10.7)", () => {
  it("returns only the reader's own rows from every table it reads, with no filter at all", async () => {
    const rows = await withRole(db, "authenticated", ALICE, async () => ({
      profiles: (await db.query<{ id: string }>("select id from public.profiles")).rows,
      products: (await db.query<{ id: string }>("select id from public.products")).rows,
      terms: (await db.query<{ product_id: string }>("select product_id from public.search_terms"))
        .rows,
      competitors: (
        await db.query<{ product_id: string }>("select product_id from public.competitors")
      ).rows,
      feed: (await db.query<{ product_id: string }>("select product_id from public.feed_items"))
        .rows,
      stats: (await db.query("select * from public.term_stats")).rows,
    }));
    expect(rows.profiles.map((r) => r.id)).toEqual([ALICE]);
    expect(rows.products.map((r) => r.id)).toEqual([ids.alice]);
    expect(rows.terms.map((r) => r.product_id)).toEqual([ids.alice]);
    expect(rows.competitors.map((r) => r.product_id)).toEqual([ids.alice]);
    expect(rows.feed.map((r) => r.product_id)).toEqual([ids.alice]);
    expect(rows.stats).toHaveLength(1);
  });
});

describe("account deletion (10.6)", () => {
  beforeAll(async () => {
    // What the admin API's deleteUser does to our schema: the auth row goes, and every
    // reference cascades or is cleared.
    await db.query("delete from auth.users where id = $1", [ALICE]);
  });

  it("removes the profile, the product and every row that belongs to it", async () => {
    const p = [ids.alice];
    expect(await count("select count(*) n from public.profiles where id = $1", [ALICE])).toBe(0);
    expect(await count("select count(*) n from public.products where owner_id = $1", [ALICE])).toBe(
      0,
    );
    for (const table of [
      "search_terms",
      "competitors",
      "product_posts",
      "usage_ledger",
      "jobs",
      "llm_reservations",
    ])
      expect(await count(`select count(*) n from public.${table} where product_id = $1`, p)).toBe(
        0,
      );
    expect(
      await count(
        "select count(*) n from public.term_stats s where not exists (select 1 from public.search_terms t where t.id = s.term_id)",
      ),
    ).toBe(0);
  });

  it("keeps cost and analytics rows only without any link to the person", async () => {
    expect(
      await count("select count(*) n from public.llm_usage where product_id = $1", [ids.alice]),
    ).toBe(0);
    expect(await count("select count(*) n from public.llm_usage where product_id is null")).toBe(1);
    expect(await count("select count(*) n from public.events where user_id = $1", [ALICE])).toBe(0);
  });

  it("leaves every other account untouched", async () => {
    expect(await count("select count(*) n from public.profiles where id = $1", [BOB])).toBe(1);
    for (const table of ["search_terms", "competitors", "product_posts", "jobs", "usage_ledger"])
      expect(
        await count(`select count(*) n from public.${table} where product_id = $1`, [ids.bob]),
      ).toBe(1);
  });

  it("the next purge deletes the posts nobody links to any more, and only those", async () => {
    await withRole(db, "service_role", null, () =>
      db.query("select public.purge_expired($1)", [new Date(Date.now() + 2 * DAY).toISOString()]),
    );
    expect(await count("select count(*) n from public.posts where id = $1", [ids.alicePost])).toBe(
      0,
    );
    expect(await count("select count(*) n from public.posts where id = $1", [ids.bobPost])).toBe(1);
  });
});

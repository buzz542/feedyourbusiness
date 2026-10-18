import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `classification` (docs/PLAN.md 6.4): the labels the classifier adds to a product's
 * post (competitor, tool, rival issue, sentiment, switching, summary, highlight, term), with the
 * highlight range checked and the owner still able to change only `state`.
 */

const MIGRATION = migrationNamed("classification");
const ALICE = "00000000-0000-4000-8000-0000000000a1";

let db: PGlite;
let product = "";
let post = "";
let competitor = "";
let term = "";

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;

const label = (over: Record<string, unknown> = {}) => {
  const row = {
    product_id: product,
    post_id: post,
    relevance: 70,
    category: "mentions_competitor",
    reason: "Asks for an alternative to a competitor.",
    competitor_id: competitor,
    tool_mentioned: "Ledgerly",
    rival_issue: "pricing",
    rival_sentiment: "negative",
    switching: true,
    rival_summary: "Finds the competitor too expensive for a small team.",
    highlight_start: 0,
    highlight_end: 20,
    term_id: term,
    ...over,
  };
  const cols = Object.keys(row);
  return db.query(
    `insert into public.product_posts (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(row),
  );
};

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1)", [ALICE]);
  product = (
    await one<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://p.example.test', 'P') returning id",
      [ALICE],
    )
  ).id;
  post = (
    await one<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash, community)
       values ('hackernews', '1', 'https://news.ycombinator.com/item?id=1', 'Ledgerly is too expensive for us, any alternative?', now(), now(), now() + interval '30 days', 'h', 'Hacker News')
       returning id`,
    )
  ).id;
});

beforeEach(async () => {
  await db.query("delete from public.product_posts");
  await db.query("delete from public.competitors");
  await db.query("delete from public.search_terms");
  competitor = (
    await one<{ id: string }>(
      "insert into public.competitors (product_id, name, origin) values ($1, 'Ledgerly', 'user') returning id",
      [product],
    )
  ).id;
  term = (
    await one<{ id: string }>(
      "insert into public.search_terms (product_id, term) values ($1, 'invoice tool') returning id",
      [product],
    )
  ).id;
});

afterAll(async () => {
  await db.close();
});

describe("classification labels", () => {
  it("stores every label the classifier produces", async () => {
    await label();
    expect(
      await one(
        "select tool_mentioned, rival_issue, rival_sentiment, switching, highlight_start, highlight_end from public.product_posts",
      ),
    ).toEqual({
      tool_mentioned: "Ledgerly",
      rival_issue: "pricing",
      rival_sentiment: "negative",
      switching: true,
      highlight_start: 0,
      highlight_end: 20,
    });
  });

  it.each([
    ["an end without a start", { highlight_start: null, highlight_end: 20 }],
    ["a start without an end", { highlight_start: 5, highlight_end: null }],
    ["an end before the start", { highlight_start: 20, highlight_end: 10 }],
    ["an empty highlight", { highlight_start: 10, highlight_end: 10 }],
    ["a highlight past the excerpt", { highlight_start: 270, highlight_end: 281 }],
  ])("refuses %s", async (_label, over) => {
    await expect(label(over)).rejects.toThrow(
      /product_posts_highlight_range|highlight_end_check|highlight_start_check/,
    );
  });

  it("allows no highlight at all", async () => {
    await label({ highlight_start: null, highlight_end: null });
  });

  it.each([
    ["an unknown rival issue", { rival_issue: "politics" }],
    ["an unknown sentiment", { rival_sentiment: "angry" }],
    ["a tool name over 60 characters", { tool_mentioned: "x".repeat(61) }],
    ["a rival summary over 200 characters", { rival_summary: "x".repeat(201) }],
  ])("refuses %s", async (_label, over) => {
    await expect(label(over)).rejects.toThrow(/check/);
  });

  it("keeps the label when its competitor or term is deleted", async () => {
    await label();
    await db.query("delete from public.competitors where id = $1", [competitor]);
    await db.query("delete from public.search_terms where id = $1", [term]);
    expect(await one("select competitor_id, term_id from public.product_posts")).toEqual({
      competitor_id: null,
      term_id: null,
    });
  });

  it("still lets the owner change only state", async () => {
    const { rows } = await label();
    const id = (rows[0] as { id: string }).id;
    await asAlice(() =>
      db.query("update public.product_posts set state = 'saved' where id = $1", [id]),
    );
    for (const column of [
      "tool_mentioned = 'x'",
      "rival_summary = 'x'",
      "highlight_start = 1",
      "switching = false",
      "competitor_id = null",
      "term_id = null",
    ])
      await expect(
        asAlice(() => db.query(`update public.product_posts set ${column} where id = $1`, [id])),
        column,
      ).rejects.toThrow(/permission denied/);
  });

  it("indexes the Today feed and the Rivals tab", async () => {
    const names = (
      await db.query<{ indexname: string }>(
        "select indexname from pg_indexes where tablename = 'product_posts'",
      )
    ).rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining(["product_posts_today_idx", "product_posts_rival_idx"]),
    );
  });
});

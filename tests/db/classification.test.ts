import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, withRole } from "./harness";

/**
 * Migration `classification` (docs/PLAN.md 6.4): the classifier's labels on product_posts. The
 * highlight range, whole rival labels, labels that point only at the product's own competitor and
 * term, the owner still updating only `state`, and dedupe: one post row per post, one link per
 * product (M4 "Dedupe").
 */

const MIGRATION = "_classification";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const NOW = "2026-11-02T12:00:00Z";

let db: PGlite;
let alice = "";
let bob = "";
let aliceRival = "";
let bobRival = "";
let aliceTerm = "";
let bobTerm = "";

const rows = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0] as T;
const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);

const ingest = (externalId: string, url = `https://news.ycombinator.com/item?id=${externalId}`) =>
  asService(
    async () =>
      (
        await one<{ id: string }>(
          "select public.ingest_post('hackernews', $1, $2, 'Looking for a tool that chases invoices.', $3, 'hash-1', 'Hacker News', $4) as id",
          [externalId, url, "2026-11-02T10:00:00Z", NOW],
        )
      ).id,
  );

const link = (product: string, post: string, extra: Record<string, unknown> = {}) => {
  const columns = [
    "product_id",
    "post_id",
    "relevance",
    "category",
    "reason",
    ...Object.keys(extra),
  ];
  const values = [
    product,
    post,
    80,
    "looking_for_tool",
    "Asks for a tool.",
    ...Object.values(extra),
  ];
  return asService(() =>
    db.query(
      `insert into public.product_posts (${columns.join(", ")}) values (${columns
        .map((_, i) => `$${i + 1}`)
        .join(", ")}) on conflict (product_id, post_id) do nothing`,
      values,
    ),
  );
};

beforeAll(async () => {
  db = await createDb({ stopBefore: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  const product = async (owner: string, url: string) =>
    (
      await one<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, $2, 'P') returning id",
        [owner, url],
      )
    ).id;
  alice = await product(ALICE, "https://alice.example.test");
  bob = await product(BOB, "https://bob.example.test");
  const rival = async (p: string) =>
    (
      await one<{ id: string }>(
        "insert into public.competitors (product_id, name) values ($1, 'Acme Invoices') returning id",
        [p],
      )
    ).id;
  aliceRival = await rival(alice);
  bobRival = await rival(bob);
  const term = async (p: string) =>
    (
      await one<{ id: string }>(
        "insert into public.search_terms (product_id, term) values ($1, 'invoice reminders') returning id",
        [p],
      )
    ).id;
  aliceTerm = await term(alice);
  bobTerm = await term(bob);
});

beforeEach(async () => {
  await db.query("delete from public.product_posts");
  await db.query("delete from public.posts");
});

afterAll(async () => {
  await db.close();
});

describe("highlight range", () => {
  it("accepts a range inside the excerpt and no range at all", async () => {
    const post = await ingest("1");
    await link(alice, post, { highlight_start: 0, highlight_end: 12 });
    const post2 = await ingest("2");
    await link(alice, post2);
    expect(
      await rows(
        "select highlight_start, highlight_end from public.product_posts order by highlight_start nulls last",
      ),
    ).toEqual([
      { highlight_start: 0, highlight_end: 12 },
      { highlight_start: null, highlight_end: null },
    ]);
  });

  it.each([
    ["only a start", { highlight_start: 3 }],
    ["only an end", { highlight_end: 3 }],
    ["an end before the start", { highlight_start: 5, highlight_end: 4 }],
    ["an empty range", { highlight_start: 5, highlight_end: 5 }],
    ["an end past 280", { highlight_start: 0, highlight_end: 281 }],
    ["a negative start", { highlight_start: -1, highlight_end: 4 }],
  ])("refuses %s", async (_, extra) => {
    const post = await ingest("3");
    await expect(link(alice, post, extra)).rejects.toThrow();
  });
});

describe("rival labels", () => {
  it("stores a whole rival label with the product's own competitor and term", async () => {
    const post = await ingest("4");
    await link(alice, post, {
      competitor_id: aliceRival,
      term_id: aliceTerm,
      rival_issue: "pricing",
      rival_sentiment: "negative",
      rival_summary: "Finds the rival too expensive for a small team.",
      switching: true,
    });
    expect(await one("select competitor_id, term_id, switching from public.product_posts")).toEqual(
      { competitor_id: aliceRival, term_id: aliceTerm, switching: true },
    );
  });

  it.each([
    ["an issue with no sentiment", { rival_issue: "pricing", rival_summary: "Too dear." }],
    ["a summary with no issue", { rival_summary: "Too dear." }],
    ["switching with no rival label", { switching: true }],
    [
      "an unknown issue",
      { rival_issue: "politics", rival_sentiment: "negative", rival_summary: "x" },
    ],
    [
      "a summary over 200",
      { rival_issue: "other", rival_sentiment: "mixed", rival_summary: "x".repeat(201) },
    ],
    ["a tool name over 60", { tool_mentioned: "x".repeat(61) }],
    ["an empty tool name", { tool_mentioned: "" }],
  ])("refuses %s", async (_, extra) => {
    const post = await ingest("5");
    await expect(link(alice, post, extra)).rejects.toThrow();
  });

  it("refuses another product's competitor or term (planted)", async () => {
    const post = await ingest("6");
    await expect(link(alice, post, { competitor_id: bobRival })).rejects.toThrow(/competitor/);
    await expect(link(alice, post, { term_id: bobTerm })).rejects.toThrow(/term/);
  });

  it("keeps the link when its competitor or term is deleted", async () => {
    const post = await ingest("7");
    const rival = (
      await one<{ id: string }>(
        "insert into public.competitors (product_id, name) values ($1, 'Gone Soon') returning id",
        [alice],
      )
    ).id;
    await link(alice, post, {
      competitor_id: rival,
      rival_issue: "support",
      rival_sentiment: "negative",
      rival_summary: "Waits days for support replies.",
    });
    await db.query("delete from public.competitors where id = $1", [rival]);
    expect(await one("select competitor_id, rival_issue from public.product_posts")).toEqual({
      competitor_id: null,
      rival_issue: "support",
    });
  });
});

describe("customer access", () => {
  it("lets the owner read the labels and update only state", async () => {
    const post = await ingest("8");
    await link(alice, post, {
      tool_mentioned: "Acme Invoices",
      highlight_start: 0,
      highlight_end: 4,
    });
    const read = await asAlice(() =>
      rows<{ tool_mentioned: string }>("select tool_mentioned from public.product_posts"),
    );
    expect(read).toEqual([{ tool_mentioned: "Acme Invoices" }]);
    await asAlice(() => db.query("update public.product_posts set state = 'saved'"));
    expect(await one("select state from public.product_posts")).toEqual({ state: "saved" });
    for (const column of [
      "competitor_id = null",
      "tool_mentioned = 'Other'",
      "rival_issue = 'pricing'",
      "switching = true",
      "rival_summary = 'x'",
      "highlight_start = 1",
      "term_id = null",
      "relevance = 99",
    ])
      await expect(
        asAlice(() => db.query(`update public.product_posts set ${column}`)),
      ).rejects.toThrow(/permission denied/);
  });

  it("never shows another user's labels", async () => {
    const post = await ingest("9");
    await link(bob, post);
    expect(await asAlice(() => rows("select id from public.product_posts"))).toEqual([]);
  });
});

describe("dedupe", () => {
  it("keeps one post row when two terms or two URL forms find the same post", async () => {
    const first = await ingest("10");
    const again = await ingest("10", "https://news.ycombinator.com/item?id=10&p=2");
    expect(again).toBe(first);
    expect(await one("select count(*)::int as n from public.posts")).toEqual({ n: 1 });
  });

  it("keeps one link per product, and one for each product", async () => {
    const post = await ingest("11");
    await link(alice, post, { term_id: aliceTerm });
    await link(alice, post, { term_id: null });
    await link(bob, post);
    expect(
      await rows("select product_id from public.product_posts order by product_id = $1 desc", [
        alice,
      ]),
    ).toEqual([{ product_id: alice }, { product_id: bob }]);
  });
});

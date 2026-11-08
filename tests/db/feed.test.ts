import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CATEGORIES,
  FEED_SOURCES,
  feedConditions,
  parseFeedParams,
  type FeedFilter,
  type FeedView,
} from "@/server/store/feed";
import { feedSql as toSql } from "./feed-sql";
import { applyMigrationsFrom, createDb, withRole } from "./harness";

/**
 * The Reply feed (docs/PLAN.md 4.4, M5 "Feed queries"): 200 seeded links for one owner and some for
 * another, read through the `feed_items` view as the owner, with the same condition list the app
 * sends. On the real clock, because RLS hides posts past delete_after by the database's now().
 */

const MIGRATION = "_reply_feed";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const STATES = ["new", "new", "new", "saved", "replied", "hidden", "new"] as const;
const HOUR = 3_600_000;
const now = new Date();

let db: PGlite;
let alice = "";
let bob = "";
let rival = "";

interface Seed {
  id: string;
  state: string;
  relevance: number;
  category: string;
  source: string;
  createdAt: Date;
  competitorId: string | null;
  excerpt: string;
}
const seeded: Seed[] = [];

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;

async function read(productId: string, filter: FeedFilter, view: FeedView = filter.view) {
  const { where, params } = toSql(feedConditions(productId, filter, view, now, 60));
  const rows = await withRole(
    db,
    "authenticated",
    ALICE,
    async () =>
      (
        await db.query<{ id: string }>(
          `select id from public.feed_items where ${where} order by relevance desc, created_at desc, id`,
          params,
        )
      ).rows,
  );
  return rows.map((r) => r.id);
}

function expected(filter: FeedFilter, view: FeedView = filter.view) {
  const min = filter.min ?? 60;
  return seeded
    .filter((s) => {
      const today =
        ["new", "saved"].includes(s.state) && now.getTime() - s.createdAt.getTime() <= 24 * HOUR;
      const inView =
        view === "today" ? today : view === "all" ? s.state !== "hidden" : s.state === view;
      return (
        inView &&
        s.relevance >= min &&
        (!filter.category || s.category === filter.category) &&
        (!filter.source || s.source === filter.source) &&
        (!filter.rival || s.competitorId === filter.rival) &&
        (!filter.q || s.excerpt.toLowerCase().includes(filter.q.toLowerCase()))
      );
    })
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? -1 : 1),
    )
    .map((s) => s.id);
}

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
  rival = (
    await one<{ id: string }>(
      "insert into public.competitors (product_id, name) values ($1, 'Acme Invoices') returning id",
      [alice],
    )
  ).id;
  await withRole(db, "service_role", null, async () => {
    for (let i = 0; i < 230; i++) {
      const source = FEED_SOURCES[i % 4]!;
      const excerpt =
        i % 3 === 0 ? `Need a 100% better invoice tool, post ${i}` : `Unrelated chatter ${i}`;
      const post = await one<{ id: string }>(
        "select public.ingest_post($1, $2, $3, $4, $5, $6, $7, $8) as id",
        [
          source,
          `ext-${i}`,
          source === "reddit"
            ? `https://www.reddit.com/r/SaaS/comments/x${i}/`
            : `https://news.ycombinator.com/item?id=${i}`,
          excerpt,
          new Date(now.getTime() - 50 * HOUR).toISOString(),
          `hash-${i}`,
          source === "reddit" ? "r/SaaS" : null,
          now.toISOString(),
        ],
      );
      const owner = i < 200 ? alice : bob;
      const s: Seed = {
        id: "",
        state: STATES[i % STATES.length]!,
        relevance: 40 + ((i * 7) % 56),
        category: CATEGORIES[i % 5]!,
        source,
        createdAt: new Date(now.getTime() - (i % 48) * HOUR - 60_000),
        competitorId: owner === alice && i % 10 === 0 ? rival : null,
        excerpt,
      };
      const link = await one<{ id: string }>(
        "insert into public.product_posts (product_id, post_id, relevance, category, reason, state, created_at, competitor_id) values ($1, $2, $3, $4, 'Matches.', $5, $6, $7) returning id",
        [
          owner,
          post.id,
          s.relevance,
          s.category,
          s.state,
          s.createdAt.toISOString(),
          s.competitorId,
        ],
      );
      if (owner === alice) seeded.push({ ...s, id: link.id });
    }
  });
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("feed views and filters", () => {
  const cases: [string, Record<string, string>][] = [
    ["today", {}],
    ["all", { view: "all" }],
    ["saved", { view: "saved" }],
    ["replied", { view: "replied" }],
    ["a category", { view: "all", category: "wish" }],
    ["a source", { view: "all", source: "reddit" }],
    ["a rival", { view: "all", rival: "RIVAL" }],
    ["a minimum match", { view: "all", min: "80" }],
    ["text search with a literal %", { view: "all", q: "100% better" }],
    [
      "everything at once",
      { category: "looking_for_tool", source: "hackernews", min: "45", q: "invoice" },
    ],
  ];

  it.each(cases)("returns the right rows for %s", async (_, raw) => {
    const filter = parseFeedParams({ ...raw, ...(raw.rival ? { rival: rival } : {}) });
    const want = expected(filter);
    expect(want.length).toBeGreaterThan(0);
    expect(await read(alice, filter)).toEqual(want);
  });

  it("counts every view with the same filters", async () => {
    const filter = parseFeedParams({ source: "bluesky" });
    for (const view of ["today", "all", "saved", "replied"] as const)
      expect((await read(alice, filter, view)).length).toBe(expected(filter, view).length);
  });

  it("never returns another user's rows, even asked by product id", async () => {
    expect(await read(bob, parseFeedParams({ view: "all", min: "40" }))).toEqual([]);
    const all = await read(alice, parseFeedParams({ view: "all", min: "40" }));
    expect(all).toHaveLength(seeded.filter((s) => s.state !== "hidden").length);
  });

  it("drops a post marked replied from Today, and only state changes", async () => {
    const filter = parseFeedParams({});
    const [first] = await read(alice, filter);
    await withRole(db, "authenticated", ALICE, () =>
      db.query("update public.product_posts set state = 'replied' where id = $1", [first]),
    );
    expect(await read(alice, filter)).not.toContain(first);
    expect(await read(alice, parseFeedParams({ view: "replied", min: "40" }))).toContain(first);
    await expect(
      withRole(db, "authenticated", ALICE, () =>
        db.query("update public.product_posts set relevance = 99 where id = $1", [first]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps the view closed to anon and exposes no author column", async () => {
    await expect(
      withRole(db, "anon", null, () => db.query("select id from public.feed_items")),
    ).rejects.toThrow(/permission denied/);
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'feed_items'",
    );
    expect(columns.rows.map((c) => c.column_name).filter((c) => /author/.test(c))).toEqual([]);
  });
});

describe("retention through the view", () => {
  it("hides a link whose post is past delete_after from its owner", async () => {
    const [first] = await read(alice, parseFeedParams({ view: "all", min: "40" }));
    await db.query(
      "update public.posts set delete_after = collected_at where id = (select post_id from public.product_posts where id = $1)",
      [first],
    );
    expect(await read(alice, parseFeedParams({ view: "all", min: "40" }))).not.toContain(first);
  });
});

describe("parseFeedParams", () => {
  it("falls back to defaults on anything unreadable", () => {
    expect(
      parseFeedParams({
        view: "nope",
        category: "x",
        source: "linkedin",
        rival: "1",
        min: "5",
        page: "-2",
      }),
    ).toEqual({ view: "today", page: 1 });
    expect(parseFeedParams({ view: ["saved", "all"], q: "  " })).toEqual({
      view: "saved",
      page: 1,
    });
  });
});

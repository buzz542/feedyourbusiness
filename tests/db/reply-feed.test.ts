import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `reply_feed` (docs/PLAN.md 4.4): the Reply tab's views (Today, All, Saved, Replied)
 * and filters (category, source, rival, minimum match, text) over 200 seeded rows, sorted by match
 * then newest, paged 50 at a time, with counts. The functions run as the caller, so RLS decides:
 * another user's rows never come back, nor do expired posts.
 */

const MIGRATION = migrationNamed("reply_feed");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const HOUR = 3_600_000;
// The posts policy compares delete_after with the real clock, so rows are seeded around it.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);

const SOURCES = ["reddit", "hackernews", "bluesky"] as const;
const CATEGORIES = [
  "looking_for_tool",
  "pain_point",
  "mentions_you",
  "mentions_competitor",
  "wish",
] as const;
const STATES = ["saved", "replied", "hidden"] as const;

interface Seed {
  key: string;
  source: (typeof SOURCES)[number];
  category: (typeof CATEGORIES)[number];
  relevance: number;
  state: string;
  linkedAt: Date;
  postedAt: Date;
  rival: "c1" | "c2" | null;
  excerpt: string;
}

/** 200 rows for Alice with every combination the filters care about. */
const SEEDS: Seed[] = Array.from({ length: 200 }, (_, i) => {
  const category = CATEGORIES[i % 5]!;
  return {
    key: `a${i}`,
    source: SOURCES[i % 3]!,
    category,
    relevance: 40 + ((i * 7) % 56),
    state: i % 10 < 3 ? STATES[i % 10]! : "new",
    linkedAt: new Date(NOW.getTime() - (i % 48) * HOUR - 60_000),
    postedAt: new Date(NOW.getTime() - (i % 48) * HOUR - 120_000 - i * 1000),
    rival: category === "mentions_competitor" ? (i % 2 ? "c1" : "c2") : null,
    excerpt:
      i % 4 === 0
        ? `Post ${i}: any tool for 100% of late_invoice reminders?`
        : `Post ${i}: something else entirely.`,
  };
});

let db: PGlite;
let alice = "";
let bob = "";
const ids = new Map<string, string>(); // product_posts id -> seed key
const competitors: Record<string, string> = {};

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const asBob = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", BOB, fn);

interface Filters {
  view: "today" | "all" | "saved" | "replied";
  category?: string | null;
  source?: string | null;
  competitor?: string | null;
  min?: number;
  query?: string | null;
  limit?: number;
  offset?: number;
}

async function feed(f: Filters, product = alice, as = asAlice) {
  const { rows } = await as(() =>
    db.query<{ id: string; competitor_name: string | null; excerpt: string }>(
      "select * from public.reply_feed($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        product,
        f.view,
        f.category ?? null,
        f.source ?? null,
        f.competitor ?? null,
        f.min ?? 40,
        f.query ?? null,
        f.limit ?? 500,
        f.offset ?? 0,
        NOW.toISOString(),
      ],
    ),
  );
  return rows;
}

const keys = (rows: { id: string }[]) => rows.map((r) => ids.get(r.id) ?? `foreign:${r.id}`);

/** The same rules in plain code, to compare against. */
function expected(f: Filters): string[] {
  const inView = (s: Seed) =>
    f.view === "today"
      ? (s.state === "new" || s.state === "saved") &&
        NOW.getTime() - s.linkedAt.getTime() < 24 * HOUR
      : f.view === "all"
        ? s.state !== "hidden"
        : s.state === (f.view === "saved" ? "saved" : "replied");
  return SEEDS.filter(
    (s) =>
      inView(s) &&
      (!f.category || s.category === f.category) &&
      (!f.source || s.source === f.source) &&
      (!f.competitor || s.rival === f.competitor) &&
      s.relevance >= (f.min ?? 40) &&
      (!f.query || s.excerpt.toLowerCase().includes(f.query.toLowerCase())),
  )
    .sort((a, b) => b.relevance - a.relevance || b.postedAt.getTime() - a.postedAt.getTime())
    .map((s) => s.key);
}

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  const product = async (owner: string, url: string) =>
    (
      await db.query<{ id: string }>(
        "insert into public.products (owner_id, url, name, status) values ($1, $2, 'P', 'active') returning id",
        [owner, url],
      )
    ).rows[0]!.id;
  alice = await product(ALICE, "https://alice.example.test");
  bob = await product(BOB, "https://bob.example.test");
  for (const [key, name] of [
    ["c1", "Ledgerly"],
    ["c2", "Paidly"],
  ] as const)
    competitors[key] = (
      await db.query<{ id: string }>(
        "insert into public.competitors (product_id, name) values ($1, $2) returning id",
        [alice, name],
      )
    ).rows[0]!.id;

  const post = async (source: string, externalId: string, excerpt: string, postedAt: Date) => {
    const days = source === "reddit" ? 7 : 30;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash, community)
       values ($1, $2, $3, $4, $5, $6, $6::timestamptz + make_interval(days => $7), 'h', $8) returning id`,
      [
        source,
        externalId,
        `https://example.test/${source}/${externalId}`,
        excerpt,
        postedAt.toISOString(),
        NOW.toISOString(),
        days,
        source === "reddit" ? "r/freelance" : null,
      ],
    );
    return rows[0]!.id;
  };
  for (const s of SEEDS) {
    const postId = await post(s.source, s.key, s.excerpt, s.postedAt);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.product_posts (product_id, post_id, relevance, category, reason, state, created_at, competitor_id)
       values ($1, $2, $3, $4, 'A reason.', $5, $6, $7) returning id`,
      [
        alice,
        postId,
        s.relevance,
        s.category,
        s.state,
        s.linkedAt.toISOString(),
        s.rival ? competitors[s.rival] : null,
      ],
    );
    ids.set(rows[0]!.id, s.key);
  }
  // Bob's rows: one on a post Alice also has, one of his own. Neither may reach Alice.
  const shared = (await db.query<{ id: string }>("select id from public.posts limit 1")).rows[0]!
    .id;
  const own = await post("hackernews", "b1", "Bob's own post about invoice reminders", NOW);
  for (const postId of [shared, own])
    await db.query(
      `insert into public.product_posts (product_id, post_id, relevance, category, reason)
       values ($1, $2, 99, 'looking_for_tool', 'Bob reason.')`,
      [bob, postId],
    );
});

afterAll(async () => {
  await db.close();
});

describe("reply_feed", () => {
  it.each(["today", "all", "saved", "replied"] as const)(
    "returns the right rows for %s, by match then newest",
    async (view) => {
      const want = expected({ view });
      expect(want.length).toBeGreaterThan(0);
      expect(keys(await feed({ view }))).toEqual(want);
    },
  );

  it.each([
    { view: "all", category: "pain_point" },
    { view: "all", source: "hackernews" },
    { view: "today", source: "reddit", category: "wish" },
    { view: "all", competitor: "c1" },
    { view: "all", min: 75 },
    { view: "today", min: 60, query: "LATE_INVOICE" },
    { view: "all", query: "100%" },
    { view: "saved", source: "bluesky", min: 50 },
  ] as const)("filters: %j", async (f) => {
    const rival = "competitor" in f ? (f.competitor as string) : null;
    const filters = { ...f, competitor: rival ? competitors[rival] : null };
    const want = expected({ ...f, competitor: rival });
    expect(keys(await feed(filters))).toEqual(want);
  });

  it("treats % and _ in the search text literally", async () => {
    expect(await feed({ view: "all", query: "%" })).toHaveLength(
      expected({ view: "all", query: "%" }).length,
    );
    expect(await feed({ view: "all", query: "x_y" })).toEqual([]);
    expect(await feed({ view: "all", query: "%%%%" })).toEqual([]);
  });

  it("pages 50 at a time with no row twice", async () => {
    const all = expected({ view: "all" });
    const pages = [];
    for (let offset = 0; offset < all.length; offset += 50)
      pages.push(...keys(await feed({ view: "all", limit: 50, offset })));
    expect(pages).toEqual(all);
  });

  it("names the rival on a card", async () => {
    const [row] = await feed({ view: "all", competitor: competitors.c2 });
    expect(row!.competitor_name).toBe("Paidly");
  });

  it("never returns another user's rows, even for their product id", async () => {
    expect(keys(await feed({ view: "all" }))).not.toContainEqual(
      expect.stringMatching(/^foreign:/),
    );
    expect(await feed({ view: "all" }, bob)).toEqual([]);
    const bobs = await feed({ view: "all" }, bob, asBob);
    expect(bobs).toHaveLength(2);
    expect(await feed({ view: "all" }, alice, asBob)).toEqual([]);
  });

  it("never returns a post past its delete_after", async () => {
    // A separate post, so the seeded rows stay as the other tests expect them.
    const { rows } = await db.query<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash)
       values ('hackernews', 'expired', 'https://example.test/expired', 'Expired post', now() - interval '31 days',
         now() - interval '31 days', now() - interval '1 day', 'h') returning id`,
    );
    await db.query(
      `insert into public.product_posts (product_id, post_id, relevance, category, reason)
       values ($1, $2, 99, 'looking_for_tool', 'Expired.')`,
      [alice, rows[0]!.id],
    );
    const all = await feed({ view: "all" });
    expect(all.map((r) => r.excerpt)).not.toContain("Expired post");
    expect(keys(all)).toEqual(expected({ view: "all" }));
  });

  it("is not callable by anon", async () => {
    await expect(
      withRole(db, "anon", null, () =>
        db.query("select * from public.reply_feed($1, 'all')", [alice]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("reply_counts", () => {
  it("counts each view with the same filters", async () => {
    const f = { source: "reddit" as const, min: 50 };
    const { rows } = await asAlice(() =>
      db.query<{ today: number; all_posts: number; saved: number; replied: number }>(
        "select * from public.reply_counts($1, null, $2, null, $3, null, $4)",
        [alice, f.source, f.min, NOW.toISOString()],
      ),
    );
    expect(rows[0]).toEqual({
      today: expected({ view: "today", ...f }).length,
      all_posts: expected({ view: "all", ...f }).length,
      saved: expected({ view: "saved", ...f }).length,
      replied: expected({ view: "replied", ...f }).length,
    });
  });

  it("counts nothing of another user's", async () => {
    const { rows } = await asBob(() =>
      db.query<{ all_posts: number }>("select * from public.reply_counts($1)", [alice]),
    );
    expect(Number(rows[0]!.all_posts)).toBe(0);
  });
});

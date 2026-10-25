import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `collection_hardening`, from the second M3 review: a job abandoned mid-run fails after
 * three tries, the purge runs first, expired posts are never readable, retention cannot be
 * extended, Reddit profile posts are refused, settle and the monthly cap guard their inputs, and
 * every closed removal request is purged after 12 months.
 */

const MIGRATION = migrationNamed("collection_hardening");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const T0 = "2026-10-17T06:00:00Z";

let db: PGlite;
let product = "";

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const rows = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0] as T;

const claim = (now: string, limit = 10) =>
  asService(() =>
    rows<{ id: string; kind: string; status: string; payload: Record<string, unknown> }>(
      "select id, kind, status, payload from public.claim_jobs($1, $2, 300)",
      [now, limit],
    ),
  );
const job = async (kind: string, runAfter = T0) =>
  (
    await one<{ id: string }>(
      "insert into public.jobs (kind, product_id, source, run_after) values ($1, $2, $3, $4) returning id",
      [kind, kind === "purge" ? null : product, kind === "purge" ? null : "hackernews", runAfter],
    )
  ).id;
const later = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

const insertPost = (over: Record<string, unknown> = {}) =>
  one<{ id: string }>(
    `insert into public.posts (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash, community)
     values ($1, $2, $3, 'An invented excerpt', now() - interval '1 day', $4, $5, 'hash', $6) returning id`,
    [
      over.source ?? "hackernews",
      over.externalId ?? "1",
      over.url ?? "https://news.ycombinator.com/item?id=1",
      over.collectedAt ?? new Date().toISOString(),
      over.deleteAfter ?? new Date(Date.now() + 86_400_000).toISOString(),
      over.community ?? "Hacker News",
    ],
  );

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
});

beforeEach(async () => {
  await db.query("delete from public.product_posts");
  await db.query("delete from public.posts");
  await db.query("delete from public.jobs");
  await db.query("delete from public.usage_ledger");
  await db.query("delete from public.removal_requests");
});

afterAll(async () => {
  await db.close();
});

describe("claim_jobs", () => {
  it("counts an expired lease as a failure, and fails the job for good on the third", async () => {
    const id = await job("collect");
    // Claimed, then the function is killed: the lease runs out three times.
    expect((await claim(T0)).map((j) => j.id)).toEqual([id]);
    const second = await claim(later(6));
    expect(second.map((j) => j.payload.failures)).toEqual([1]);
    const third = await claim(later(12));
    expect(third.map((j) => j.payload.failures)).toEqual([2]);
    expect(await claim(later(18))).toEqual([]);
    expect(
      await one(
        "select status, last_error, finished_at is not null as finished from public.jobs where id = $1",
        [id],
      ),
    ).toEqual({ status: "failed", last_error: "LeaseExpired", finished: true });
  });

  it("does not count a lease that has not run out, or a job that is waiting", async () => {
    const id = await job("collect");
    await claim(T0);
    expect(await claim(later(2))).toEqual([]); // still leased
    await db.query("update public.jobs set status = 'waiting', locked_until = null where id = $1", [
      id,
    ]);
    const again = await claim(later(3));
    expect(again[0]?.payload.failures).toBeUndefined();
  });

  it("claims the purge, then deletion sync, before any collect job", async () => {
    await job("collect", later(-30));
    await job("deletion_sync", later(-10));
    await job("purge", later(-5));
    // Picked first, and returned first: the runner works through a batch in this order.
    expect((await claim(T0, 2)).map((j) => j.kind)).toEqual(["purge", "deletion_sync"]);
    expect((await claim(T0, 2)).map((j) => j.kind)).toEqual(["collect"]);
  });
});

describe("expired posts", () => {
  it("are invisible to their owner before the purge runs; fresh ones stay visible", async () => {
    const expired = await insertPost({
      externalId: "1",
      collectedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      deleteAfter: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const fresh = await insertPost({
      externalId: "2",
      url: "https://news.ycombinator.com/item?id=2",
    });
    for (const post of [expired.id, fresh.id])
      await db.query(
        "insert into public.product_posts (product_id, post_id, relevance, category, reason) values ($1, $2, 70, 'wish', 'A wish.')",
        [product, post],
      );
    const seen = await asAlice(() => rows<{ id: string }>("select id from public.posts"));
    expect(seen.map((r) => r.id)).toEqual([fresh.id]);
  });
});

describe("retention cannot be extended", () => {
  it("refuses a change to collected_at and any later delete_after, even for the service role", async () => {
    const { id } = await insertPost();
    await expect(
      asService(() =>
        db.query(
          "update public.posts set collected_at = collected_at + interval '1 day' where id = $1",
          [id],
        ),
      ),
    ).rejects.toThrow(/retention/);
    await expect(
      asService(() =>
        db.query(
          "update public.posts set delete_after = delete_after + interval '1 hour' where id = $1",
          [id],
        ),
      ),
    ).rejects.toThrow(/retention/);
    // Shortening it is fine.
    await asService(() =>
      db.query(
        "update public.posts set delete_after = delete_after - interval '1 hour' where id = $1",
        [id],
      ),
    );
  });

  it("never dates a post's collection in the future, whatever the caller passes", async () => {
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const { id } = await asService(() =>
      one<{ id: string }>(
        "select public.ingest_post('reddit', 't3_x', 'https://www.reddit.com/r/SaaS/comments/x/', 'x', now(), 'h', 'r/SaaS', $1) as id",
        [future],
      ),
    );
    const post = await one<{ in_future: boolean; days: number }>(
      "select collected_at > now() as in_future, extract(day from delete_after - now())::int as days from public.posts where id = $1",
      [id],
    );
    expect(post.in_future).toBe(false);
    expect(post.days).toBeLessThanOrEqual(7);
  });
});

describe("Reddit profile posts", () => {
  it.each([
    ["a u_ community", { community: "r/u_example_person" }],
    ["a /user/ link", { url: "https://www.reddit.com/user/example_person/comments/1/x/" }],
    ["a /u/ link", { url: "https://www.reddit.com/u/example_person/comments/1/x/" }],
  ])("are refused: %s", async (_label, over) => {
    await expect(
      insertPost({
        source: "reddit",
        externalId: "t3_1",
        url: "https://www.reddit.com/r/SaaS/comments/1/x/",
        community: "r/SaaS",
        deleteAfter: new Date(Date.now() + 86_400_000).toISOString(),
        ...over,
      }),
    ).rejects.toThrow(/posts_reddit_no_profile/);
  });

  it("leaves community posts and other sources alone", async () => {
    await insertPost({
      source: "reddit",
      externalId: "t3_2",
      url: "https://www.reddit.com/r/SaaS/comments/2/x/",
      community: "r/SaaS",
    });
    await insertPost({
      source: "bluesky",
      externalId: "b1",
      url: "https://bsky.app/profile/did:plc:example/post/1",
      community: "Bluesky",
    });
  });
});

describe("budgets", () => {
  const settle = (reserved: number, actual: number) =>
    asService(() =>
      db.query("select public.settle_budget($1, 'reddit', '2026-10-17', $2, $3, 0)", [
        product,
        reserved,
        actual,
      ]),
    );
  const reads = async () =>
    (
      await one<{ reads: number }>("select reads from public.usage_ledger where product_id = $1", [
        product,
      ])
    ).reads;

  it("refuses negative units", async () => {
    await expect(settle(10, -100)).rejects.toThrow(/must not be negative/);
    await expect(settle(-1, 0)).rejects.toThrow(/must not be negative/);
  });

  it("adds an overrun to the ledger, so the monthly cap sees every record used", async () => {
    await db.query(
      "insert into public.usage_ledger (product_id, source, usage_date, reads) values ($1, 'reddit', '2026-10-17', 10)",
      [product],
    );
    await settle(10, 14);
    expect(await reads()).toBe(14);
    await settle(14, 4);
    expect(await reads()).toBe(4);
  });
});

describe("purge_expired", () => {
  it.each(["removed", "rejected", "closed"])(
    "deletes removal requests handled as %s more than 12 months ago",
    async (status) => {
      await db.query(
        `insert into public.removal_requests (link_or_handle, contact_email, status, handled_at)
         values ('https://www.reddit.com/r/x/comments/1/', 'person@example.test', $1, now() - interval '13 months'),
                ('https://www.reddit.com/r/x/comments/2/', 'person@example.test', $1, now() - interval '11 months')`,
        [status],
      );
      await asService(() => db.query("select public.purge_expired(now())"));
      expect((await rows("select 1 from public.removal_requests")).length).toBe(1);
    },
  );

  it("keeps an open request however old", async () => {
    await db.query(
      `insert into public.removal_requests (link_or_handle, contact_email, status, handled_at)
       values ('https://www.reddit.com/r/x/comments/1/', 'person@example.test', 'verified', now() - interval '13 months')`,
    );
    await asService(() => db.query("select public.purge_expired(now())"));
    expect((await rows("select 1 from public.removal_requests")).length).toBe(1);
  });

  it("keeps an unlinked post for a day, then deletes it", async () => {
    await insertPost({
      externalId: "young",
      collectedAt: new Date(Date.now() - 23 * 3_600_000).toISOString(),
    });
    await insertPost({
      externalId: "old",
      url: "https://news.ycombinator.com/item?id=3",
      collectedAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    });
    await asService(() => db.query("select public.purge_expired(now())"));
    expect(
      (await rows<{ external_id: string }>("select external_id from public.posts")).map(
        (r) => r.external_id,
      ),
    ).toEqual(["young"]);
  });

  it("runs its rival_insights and preview_runs branches once those tables exist", async () => {
    // Later migrations create the real tables; stand-ins are used only when they do not exist yet.
    const exists = async (t: string) =>
      (await one<{ r: string | null }>("select to_regclass($1)::text as r", [`public.${t}`])).r !==
      null;
    const realRivals = await exists("rival_insights");
    const realPreviews = await exists("preview_runs");
    if (!realRivals)
      await db.query(
        "create table public.rival_insights (id serial primary key, product_id uuid, tool_name text, week date, issue text, complaints int, switching int, summary text, example_post_ids uuid[] not null default '{}')",
      );
    if (!realPreviews)
      await db.query(
        "create table public.preview_runs (id serial primary key, ip_hash text, url_host text, result jsonb, created_at timestamptz default now(), expires_at timestamptz not null)",
      );
    const { id } = await insertPost();
    const gone = "00000000-0000-4000-8000-00000000dead";
    await db.query(
      `insert into public.rival_insights (product_id, tool_name, week, issue, complaints, switching, summary, example_post_ids)
       values ($1, 'Billwise', '2026-10-12', 'pricing', 1, 0, 'x', $2)`,
      [product, [id, gone]],
    );
    await db.query(
      `insert into public.preview_runs (ip_hash, url_host, result, created_at, expires_at)
       values ('h', 'a.example.test', '{}', now() - interval '2 hours', now() - interval '1 hour'),
              ('h', 'a.example.test', '{}', now(), now() + interval '1 hour')`,
    );
    await db.query(
      "insert into public.product_posts (product_id, post_id, relevance, category, reason) values ($1, $2, 70, 'wish', 'A wish.')",
      [product, id],
    );
    const counts = await asService(() =>
      one<{ c: Record<string, number> }>("select public.purge_expired(now()) as c"),
    );
    expect(counts.c.preview_runs).toBe(1);
    expect(await one("select example_post_ids from public.rival_insights")).toEqual({
      example_post_ids: [id],
    });
    await db.query("delete from public.rival_insights");
    await db.query("delete from public.preview_runs");
    if (!realRivals) await db.query("drop table public.rival_insights");
    if (!realPreviews) await db.query("drop table public.preview_runs");
  });
});

describe("indexes", () => {
  it("covers jobs by product and the ledger by source and day", async () => {
    const names = (
      await rows<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public'",
      )
    ).map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining(["jobs_product_id_idx", "usage_ledger_source_date_idx"]),
    );
  });
});

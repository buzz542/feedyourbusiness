import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, withRole } from "./harness";

/**
 * Migration `collection` (docs/PLAN.md 6.3): posts from every collect source, jobs, budgets,
 * ingest and purge. Retention by source (D4), no author handle ever (D5), suppression at insert.
 * Consolidates what an earlier build spread over six migrations: job budgets reserved once per job,
 * term stats recorded once per job, term rotation, the Reddit re-check lists, and the hardening
 * (abandoned leases fail, purge first, retention never extended, no Reddit profile posts).
 */

const MIGRATION = "_collection";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const NOW = "2026-10-17T12:00:00Z";

let db: PGlite;
let alice = "";
let bob = "";

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const rows = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0] as T;

const ingest = (
  over: Partial<{
    source: string;
    externalId: string;
    excerpt: string;
    author: string;
    community: string | null;
    now: string;
  }> = {},
) =>
  asService(() =>
    one<{ id: string | null }>("select public.ingest_post($1, $2, $3, $4, $5, $6, $7, $8) as id", [
      over.source ?? "reddit",
      over.externalId ?? "t3_abc",
      "https://www.reddit.com/r/SaaS/comments/abc/",
      over.excerpt ?? "Looking for a tool that chases unpaid invoices.",
      "2026-10-17T10:00:00Z",
      over.author ?? "hash-author-1",
      over.community === undefined ? "r/SaaS" : over.community,
      over.now ?? NOW,
    ]),
  );

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
});

beforeEach(async () => {
  await db.query("delete from public.product_posts");
  await db.query("delete from public.posts");
  await db.query("delete from public.suppression");
  await db.query("delete from public.jobs");
  await db.query("delete from public.usage_ledger");
});

afterAll(async () => {
  await db.close();
});

describe("posts", () => {
  it.each([
    ["reddit", "7 days", true],
    ["reddit", "8 days", false],
    ["x", "7 days", true],
    ["x", "8 days", false],
    ["hackernews", "30 days", true],
    ["hackernews", "31 days", false],
    ["bluesky", "30 days", true],
    ["bluesky", "31 days", false],
  ])("caps retention for %s at %s: %s", async (source, keep, allowed) => {
    const insert = db.query(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash)
       values ($1, 'e1', 'https://example.test/p', 'x', $2, $2, $2::timestamptz + $3::interval, 'h')`,
      [source, NOW, keep],
    );
    if (allowed) await insert;
    else await expect(insert).rejects.toThrow(/posts_retention_by_source/);
  });

  it("refuses an unknown source", async () => {
    await expect(ingest({ source: "linkedin" })).rejects.toThrow(/posts_source_check/);
  });

  it("refuses an author handle (planted)", async () => {
    await expect(
      db.query(
        `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash, author_handle)
         values ('hackernews', 'e2', 'https://news.ycombinator.com/item?id=1', 'x', now(), 'h', 'someone')`,
      ),
    ).rejects.toThrow(/posts_no_author_handle/);
  });

  it("keeps the community name short", async () => {
    await expect(
      ingest({ source: "hackernews", externalId: "long", community: "r/" + "x".repeat(100) }),
    ).rejects.toThrow(/community/);
  });

  it("lets a customer read a matched post's content but never its author columns", async () => {
    // RLS hides posts past delete_after by the database clock, so this one is collected now.
    const { id } = await ingest({ now: new Date().toISOString() });
    await db.query(
      "insert into public.product_posts (product_id, post_id, relevance, category, reason) values ($1, $2, 80, 'looking_for_tool', 'r')",
      [alice, id],
    );
    const seen = await asAlice(() =>
      rows("select id, source, url, excerpt, posted_at, collected_at, community from public.posts"),
    );
    expect(seen).toHaveLength(1);
    for (const column of ["author_hash", "author_handle", "delete_after", "*"])
      await expect(asAlice(() => db.query(`select ${column} from public.posts`))).rejects.toThrow(
        /permission denied/,
      );
  });
});

describe("ingest_post", () => {
  it("stores a post with the source's retention and returns its id", async () => {
    const reddit = await ingest();
    const hn = await ingest({ source: "hackernews", externalId: "1" });
    expect(reddit.id).toBeTruthy();
    const kept = await rows<{ source: string; delete_after: Date; community: string }>(
      "select source, delete_after, community from public.posts order by source",
    );
    expect(kept.map((p) => [p.source, p.delete_after.toISOString(), p.community])).toEqual([
      ["hackernews", "2026-11-16T12:00:00.000Z", "r/SaaS"],
      ["reddit", "2026-10-24T12:00:00.000Z", "r/SaaS"],
    ]);
    expect(hn.id).not.toBe(reddit.id);
  });

  it("returns the existing id on conflict and never extends retention", async () => {
    const first = await ingest();
    const again = await ingest({ now: "2026-10-20T12:00:00Z" });
    expect(again.id).toBe(first.id);
    const [post] = await rows<{ delete_after: Date }>("select delete_after from public.posts");
    expect(post!.delete_after.toISOString()).toBe("2026-10-24T12:00:00.000Z");
  });

  it("refuses a suppressed author, for that source only", async () => {
    await db.query(
      "insert into public.suppression (author_hash, source, reason) values ('hash-author-1', 'reddit', 'removal request')",
    );
    expect((await ingest()).id).toBeNull();
    expect(await rows("select 1 from public.posts")).toHaveLength(0);
    expect((await ingest({ source: "hackernews", externalId: "9" })).id).toBeTruthy();
  });

  it("refuses an excerpt over 280 characters", async () => {
    await expect(ingest({ excerpt: "x".repeat(281) })).rejects.toThrow(/excerpt/);
  });
});

describe("jobs", () => {
  const job = (status: string, runAfter: string, extra: Record<string, unknown> = {}) =>
    one<{ id: string }>(
      `insert into public.jobs (kind, product_id, source, status, run_after, locked_until, finished_at, dedupe_key)
       values ('collect', $1, 'hackernews', $2, $3, $4, $5, $6) returning id`,
      [
        alice,
        status,
        runAfter,
        extra.lockedUntil ?? null,
        extra.finishedAt ?? null,
        extra.dedupeKey ?? null,
      ],
    );
  const claim = (now: string, limit: number) =>
    asService(() =>
      rows<{ id: string; status: string; attempts: number; locked_until: Date }>(
        "select id, status, attempts, locked_until from public.claim_jobs($1, $2, 60)",
        [now, limit],
      ),
    );

  it("claims due jobs once per lease, up to the limit", async () => {
    const due = [
      await job("queued", "2026-10-17T11:00:00Z"),
      await job("waiting", "2026-10-17T11:30:00Z"),
      await job("queued", "2026-10-17T11:59:00Z"),
    ];
    await job("queued", "2026-10-17T13:00:00Z"); // not due
    await job("done", "2026-10-17T10:00:00Z"); // finished

    const first = await claim(NOW, 2);
    expect(first).toHaveLength(2);
    expect(first.every((j) => j.status === "running" && j.attempts === 1)).toBe(true);
    expect(first[0]!.locked_until.toISOString()).toBe("2026-10-17T12:01:00.000Z");

    // A second claim inside the lease never takes the same job.
    const second = await claim(NOW, 10);
    expect(second.map((j) => j.id)).toEqual(
      due.filter((id) => !first.some((j) => j.id === id.id)).map((j) => j.id),
    );
    expect(await claim(NOW, 10)).toHaveLength(0);

    // After the lease runs out (a crashed run), the jobs can be claimed again.
    const later = await claim("2026-10-17T12:02:00Z", 10);
    expect(later).toHaveLength(3);
    expect(later.every((j) => j.attempts === 2)).toBe(true);
  });

  it("skips locked rows, so concurrent claims cannot take the same job", async () => {
    const [fn] = await rows<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'claim_jobs'",
    );
    expect(fn!.src.toLowerCase()).toMatch(/for update skip locked/);
  });

  it("counts a reclaimed lease as a failure, and fails the job at the third", async () => {
    const { id } = await job("queued", NOW);
    let at = new Date(NOW).getTime();
    for (let crash = 1; crash <= 3; crash++) {
      await claim(new Date(at).toISOString(), 1);
      at += 120_000; // the lease (60 s) runs out without a finish
    }
    await claim(new Date(at).toISOString(), 1);
    expect(await one("select status, last_error from public.jobs where id = $1", [id])).toEqual({
      status: "failed",
      last_error: "LeaseExpired",
    });
  });

  it("finishes only a running job, and never to running", async () => {
    const { id } = await job("queued", NOW);
    await asService(() => db.query("select public.finish_job($1, 'done', null, null, null)", [id]));
    expect(await one("select status from public.jobs where id = $1", [id])).toEqual({
      status: "queued",
    });
    await claim(NOW, 1);
    await expect(
      asService(() => db.query("select public.finish_job($1, 'running', null, null, null)", [id])),
    ).rejects.toThrow(/status must be/);
  });

  it("finishes, reschedules and fails jobs", async () => {
    const { id } = await job("queued", NOW);
    await claim(NOW, 1);
    await asService(() =>
      db.query("select public.finish_job($1, 'waiting', null, $2::jsonb, $3)", [
        id,
        JSON.stringify({ handle: "run-1" }),
        "2026-10-17T12:02:00Z",
      ]),
    );
    expect(
      await one(
        "select status, payload, locked_until, finished_at from public.jobs where id = $1",
        [id],
      ),
    ).toEqual({
      status: "waiting",
      payload: { handle: "run-1" },
      locked_until: null,
      finished_at: null,
    });

    await claim("2026-10-17T12:02:00Z", 1);
    await asService(() =>
      db.query("select public.finish_job($1, 'failed', 'TypeError', null, null)", [id]),
    );
    const failed = await one<{ status: string; last_error: string; finished_at: Date | null }>(
      "select status, last_error, finished_at from public.jobs where id = $1",
      [id],
    );
    expect(failed.status).toBe("failed");
    expect(failed.last_error).toBe("TypeError");
    expect(failed.finished_at).not.toBeNull();
  });

  it("merges the payload, so a checkpoint written while running survives", async () => {
    const { id } = await job("queued", NOW);
    await claim(NOW, 1);
    await db.query(`update public.jobs set payload = '{"reserved": 8}' where id = $1`, [id]);
    await asService(() =>
      db.query("select public.finish_job($1, 'queued', 'TypeError', $2::jsonb, null)", [
        id,
        JSON.stringify({ failures: 1 }),
      ]),
    );
    expect(await one("select payload from public.jobs where id = $1", [id])).toEqual({
      payload: { reserved: 8, failures: 1 },
    });
  });

  it("keeps one job per dedupe key", async () => {
    await job("queued", NOW, { dedupeKey: "collect:p:hackernews:2026-10-17" });
    await expect(
      job("queued", NOW, { dedupeKey: "collect:p:hackernews:2026-10-17" }),
    ).rejects.toThrow(/dedupe_key/);
  });
});

describe("budgets", () => {
  const consume = (units: number, limit = 10, product = alice, source = "reddit") =>
    asService(() =>
      one<{ ok: boolean }>("select public.consume_budget($1, $2, '2026-10-17', $3, $4) as ok", [
        product,
        source,
        units,
        limit,
      ]),
    ).then((r) => r.ok);
  const reads = async () =>
    await one<{ reads: number; cost_usd: string }>(
      "select reads, cost_usd from public.usage_ledger where product_id = $1 and source = 'reddit'",
      [alice],
    );

  it("refuses the reservation that would cross the limit", async () => {
    expect(await consume(6)).toBe(true);
    expect(await consume(5)).toBe(false);
    expect((await reads()).reads).toBe(6);
    expect(await consume(4)).toBe(true);
    expect((await reads()).reads).toBe(10);
    expect(await consume(1)).toBe(false);
  });

  it("settles: returns the unused units and adds the cost", async () => {
    await consume(8);
    await asService(() =>
      db.query("select public.settle_budget($1, 'reddit', '2026-10-17', 8, 3, 0.0045)", [alice]),
    );
    expect(await reads()).toEqual({ reads: 3, cost_usd: "0.0045" });
  });

  it("sums a vendor's records this month across products", async () => {
    await consume(4);
    await consume(5, 10, bob);
    await consume(9, 10, alice, "hackernews");
    expect(
      await asService(() =>
        one<{ n: number }>("select public.vendor_usage('reddit', '2026-10-01') as n"),
      ),
    ).toEqual({ n: 9 });
  });
});

describe("purge_expired", () => {
  it("deletes expired and orphaned posts, clears example ids, and old housekeeping rows", async () => {
    const expired = (await ingest({ externalId: "old", now: "2026-10-01T00:00:00Z" })).id!;
    const linked = (await ingest({ externalId: "linked" })).id!;
    const orphan = (
      await ingest({ source: "hackernews", externalId: "o", now: "2026-10-15T00:00:00Z" })
    ).id!;
    const fresh = (await ingest({ source: "hackernews", externalId: "f", now: NOW })).id!;
    for (const id of [expired, linked])
      await db.query(
        "insert into public.product_posts (product_id, post_id, relevance, category, reason) values ($1, $2, 80, 'wish', 'r')",
        [alice, id],
      );
    await db.query(
      "insert into public.themes (product_id, week, title, summary, count, example_post_ids) values ($1, '2026-10-12', 'T', 'S', 2, $2)",
      [alice, [expired, linked]],
    );
    await db.query(
      `insert into public.jobs (kind, status, finished_at) values
         ('purge', 'done', '2026-09-01T00:00:00Z'), ('purge', 'done', '2026-10-16T00:00:00Z')`,
    );
    await db.query(
      `insert into public.events (name, user_id, props, at) values
         ('feed_opened', null, '{}', '2025-09-01T00:00:00Z'), ('feed_opened', null, '{}', '2026-10-01T00:00:00Z')`,
    );
    await db.query(
      `insert into public.removal_requests (link_or_handle, contact_email, status, handled_at) values
         ('https://x.test/a', 'a@example.test', 'closed', '2025-09-01T00:00:00Z'),
         ('https://x.test/b', 'b@example.test', 'closed', '2026-09-01T00:00:00Z')`,
    );

    const result = await asService(() =>
      one<{ counts: Record<string, number> }>("select public.purge_expired($1) as counts", [NOW]),
    );
    expect(result.counts).toMatchObject({
      posts_expired: 1,
      posts_orphaned: 1,
      jobs: 1,
      events: 1,
      removal_requests: 1,
    });

    const left = (await rows<{ id: string }>("select id from public.posts"))
      .map((r) => r.id)
      .sort();
    expect(left).toEqual([linked, fresh].sort());
    void orphan;
    const [theme] = await rows<{ example_post_ids: string[] }>(
      "select example_post_ids from public.themes",
    );
    expect(theme!.example_post_ids).toEqual([linked]);
    expect(await rows("select 1 from public.jobs")).toHaveLength(1);
    expect(await rows("select 1 from public.events")).toHaveLength(1);
    expect(await rows("select 1 from public.removal_requests")).toHaveLength(1);
  });
});

describe("access", () => {
  const FUNCTIONS = [
    "select public.ingest_post('reddit', 'e', 'https://x.test', 'x', now(), 'h', null, now())",
    "select * from public.claim_jobs(now(), 1, 60)",
    "select public.finish_job(gen_random_uuid(), 'done', null, null, null)",
    "select public.consume_budget(gen_random_uuid(), 'reddit', current_date, 1, 1)",
    "select public.settle_budget(gen_random_uuid(), 'reddit', current_date, 1, 1, 0)",
    "select public.vendor_usage('reddit', current_date)",
    "select public.purge_expired(now())",
  ];

  it.each(FUNCTIONS)("refuses anon and authenticated: %s", async (sql) => {
    await expect(withRole(db, "anon", null, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
    await expect(asAlice(() => db.query(sql))).rejects.toThrow(/permission denied for function/);
  });

  it("hides jobs from customers", async () => {
    await expect(asAlice(() => db.query("select * from public.jobs"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("lets an owner read their own term stats only", async () => {
    const term = async (product: string, text: string) =>
      (
        await one<{ id: string }>(
          "insert into public.search_terms (product_id, term) values ($1, $2) returning id",
          [product, text],
        )
      ).id;
    const mine = await term(alice, "alice term");
    const theirs = await term(bob, "bob term");
    await db.query(
      "insert into public.term_stats (term_id, source, day, fetched, relevant) values ($1, 'reddit', '2026-10-17', 10, 2), ($2, 'reddit', '2026-10-17', 5, 1)",
      [mine, theirs],
    );
    const seen = await asAlice(() =>
      rows<{ term_id: string }>("select term_id from public.term_stats"),
    );
    expect(seen.map((r) => r.term_id)).toEqual([mine]);
    await expect(
      asAlice(() => db.query("update public.term_stats set fetched = 0")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("job budgets, reserved and settled once per job", () => {
  const newJob = async () =>
    (
      await one<{ id: string }>(
        "insert into public.jobs (kind, product_id, source) values ('collect', $1, 'reddit') returning id",
        [alice],
      )
    ).id;
  const reserve = (job: string, units: number, limit = 100, cap: number | null = null) =>
    asService(() =>
      one<{ r: string }>(
        "select public.reserve_job_budget($1, $2, 'reddit', '2026-10-17', $3, $4, $5) as r",
        [job, alice, units, limit, cap],
      ),
    ).then((x) => x.r);
  const ledger = () =>
    one<{ reads: number; cost_usd: string } | undefined>(
      "select reads, cost_usd from public.usage_ledger where product_id = $1 and source = 'reddit'",
      [alice],
    );

  it("reserves once: a re-run of the same job never charges again", async () => {
    const job = await newJob();
    expect(await reserve(job, 40)).toBe("reserved");
    expect(await reserve(job, 40)).toBe("already");
    expect((await ledger())!.reads).toBe(40);
  });

  it("refuses over the product's daily limit and over the vendor's monthly cap", async () => {
    expect(await reserve(await newJob(), 101)).toBe("refused");
    await db.query(
      "insert into public.usage_ledger (product_id, source, usage_date, reads) values ($1, 'reddit', '2026-10-05', 90)",
      [bob],
    );
    expect(await reserve(await newJob(), 20, 100, 100)).toBe("monthly_cap");
    expect(await reserve(await newJob(), 10, 100, 100)).toBe("reserved");
  });

  it("settles once, giving back unused units and adding the cost", async () => {
    const job = await newJob();
    await reserve(job, 40);
    const settle = () =>
      asService(() =>
        one<{ ok: boolean }>("select public.settle_job_budget($1, 25, 0.0375) as ok", [job]),
      ).then((x) => x.ok);
    expect(await settle()).toBe(true);
    expect(await settle()).toBe(false);
    expect(await ledger()).toEqual({ reads: 25, cost_usd: "0.0375" });
  });

  it("counts an overrun against the monthly cap", async () => {
    await consumeRaw(alice, 10);
    await asService(() =>
      db.query("select public.settle_budget($1, 'reddit', '2026-10-17', 10, 14, 0)", [alice]),
    );
    expect((await ledger())!.reads).toBe(14);
    await expect(
      asService(() =>
        db.query("select public.settle_budget($1, 'reddit', '2026-10-17', -1, 0, 0)", [alice]),
      ),
    ).rejects.toThrow(/negative/);
  });
});

async function consumeRaw(product: string, units: number) {
  await withRole(db, "service_role", null, () =>
    db.query("select public.consume_budget($1, 'reddit', '2026-10-17', $2, 1000)", [
      product,
      units,
    ]),
  );
}

describe("hardening", () => {
  it("fails a job whose lease ran out for the third time, and claims the purge first", async () => {
    const crashed = await one<{ id: string }>(
      `insert into public.jobs (kind, product_id, source, status, run_after, locked_until, payload)
       values ('collect', $1, 'hackernews', 'running', $2, $2, '{"failures": 2}') returning id`,
      [alice, "2026-10-17T11:00:00Z"],
    );
    await db.query(
      `insert into public.jobs (kind, product_id, source, run_after) values
         ('collect', $1, 'reddit', '2026-10-17T10:00:00Z'),
         ('deletion_sync', null, 'hackernews', '2026-10-17T11:30:00Z'),
         ('purge', null, null, '2026-10-17T11:59:00Z')`,
      [alice],
    );
    const claimed = await asService(() =>
      rows<{ kind: string }>("select kind from public.claim_jobs($1, 10, 60)", [NOW]),
    );
    expect(claimed.map((j) => j.kind)).toEqual(["purge", "deletion_sync", "collect"]);
    expect(
      await one("select status, last_error from public.jobs where id = $1", [crashed.id]),
    ).toEqual({ status: "failed", last_error: "LeaseExpired" });
  });

  it("never moves delete_after later or changes collected_at", async () => {
    const { id } = await ingest();
    await expect(
      db.query(
        "update public.posts set delete_after = delete_after + interval '1 hour' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/retention/);
    await expect(
      db.query(
        "update public.posts set collected_at = collected_at - interval '1 hour' where id = $1",
        [id],
      ),
    ).rejects.toThrow(/retention/);
    await db.query(
      "update public.posts set delete_after = delete_after - interval '1 day' where id = $1",
      [id],
    );
  });

  it("dates collection no later than the database clock, so retention cannot start late", async () => {
    const { id } = await ingest({ now: "2099-01-01T00:00:00Z" });
    const post = await one<{ collected_at: Date }>(
      "select collected_at from public.posts where id = $1",
      [id],
    );
    expect(post.collected_at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it.each([
    [null, "https://www.reddit.com/r/u_someone/comments/a/"],
    ["u_someone", "https://www.reddit.com/r/SaaS/comments/a/"],
    ["/r/u_someone", "https://www.reddit.com/r/SaaS/comments/a/"],
    ["r/SaaS", "https://www.reddit.com/r/u_someone/comments/a/"],
    ["r/u_someone", "https://www.reddit.com/r/u_someone/comments/a/"],
    ["r/SaaS", "https://www.reddit.com/user/someone/comments/a/"],
    ["r/SaaS", "https://www.reddit.com/u/someone/comments/a/"],
  ])("refuses a Reddit profile post (%s, %s)", async (community, url) => {
    await expect(
      asService(() =>
        db.query("select public.ingest_post('reddit', 'p1', $1, 'x', now(), 'h', $2, now())", [
          url,
          community,
        ]),
      ),
    ).rejects.toThrow(/posts_reddit_no_profile/);
  });

  it("hides a post past delete_after from its owner before the purge runs", async () => {
    const { id } = await ingest({ now: new Date().toISOString() });
    await db.query(
      "insert into public.product_posts (product_id, post_id, relevance, category, reason) values ($1, $2, 80, 'wish', 'r')",
      [alice, id],
    );
    await db.query(
      "update public.posts set delete_after = now() - interval '1 second' where id = $1",
      [id],
    );
    expect(await asAlice(() => rows("select id from public.posts"))).toHaveLength(0);
  });
});

describe("collectable products, terms and term stats", () => {
  it("lists only confirmed, active products of entitled accounts", async () => {
    await db.query("update public.products set status = 'active' where id = $1", [alice]);
    await db.query("update public.profiles set subscription_status = 'trialing' where id = $1", [
      ALICE,
    ]);
    await db.query("update public.profiles set subscription_status = 'active' where id = $1", [
      BOB,
    ]);
    const ids = await asService(() =>
      rows<{ id: string }>("select id from public.collectable_products()"),
    );
    expect(ids.map((r) => r.id)).toEqual([alice]); // bob's product is still a draft
    await db.query("update public.products set status = 'paused' where id = $1", [alice]);
    expect(await asService(() => rows("select id from public.collectable_products()"))).toEqual([]);
    await db.query("update public.products set status = 'active' where id = $1", [alice]);
    await db.query("update public.profiles set subscription_status = 'past_due' where id = $1", [
      ALICE,
    ]);
    expect(await asService(() => rows("select id from public.collectable_products()"))).toEqual([]);
  });

  it("rotates terms: least recently collected for the source first, paused terms never", async () => {
    await db.query("delete from public.search_terms where product_id = $1", [alice]);
    const term = async (text: string, active = true) =>
      (
        await one<{ id: string }>(
          "insert into public.search_terms (product_id, term, active) values ($1, $2, $3) returning id",
          [alice, text, active],
        )
      ).id;
    const a = await term("chase invoices");
    const b = await term("invoice reminders");
    await term("paused term", false);
    const c = await term("late payments");
    await db.query(
      "insert into public.term_stats (term_id, source, day) values ($1, 'reddit', '2026-10-16'), ($2, 'reddit', '2026-10-15'), ($3, 'hackernews', '2026-10-16')",
      [a, b, c],
    );
    const picked = await asService(() =>
      rows<{ id: string }>("select id from public.collect_terms($1, 'reddit', 2)", [alice]),
    );
    expect(picked.map((r) => r.id)).toEqual([c, b]);
  });

  it("records a job's term stats once, adding up across jobs", async () => {
    const { id: termId } = await one<{ id: string }>(
      "insert into public.search_terms (product_id, term) values ($1, 'stats term') returning id",
      [alice],
    );
    const job = async () =>
      (await one<{ id: string }>("insert into public.jobs (kind) values ('collect') returning id"))
        .id;
    const record = (jobId: string) =>
      asService(() =>
        one<{ ok: boolean }>(
          "select public.record_term_stats($1, '2026-10-17', 'reddit', $2) as ok",
          [jobId, JSON.stringify([{ term_id: termId, fetched: 10, relevant: 3 }])],
        ),
      ).then((r) => r.ok);
    const first = await job();
    expect(await record(first)).toBe(true);
    expect(await record(first)).toBe(false);
    expect(await record(await job())).toBe(true);
    expect(
      await one("select fetched, relevant from public.term_stats where term_id = $1", [termId]),
    ).toEqual({ fetched: 20, relevant: 6 });
  });
});

describe("Reddit deletion re-check lists", () => {
  it("lists posts collected in the window, once, for the product that linked them first", async () => {
    const at = new Date(Date.now() - 72 * 3600_000).toISOString();
    const shared = (await ingest({ externalId: "t3_shared", now: at })).id!;
    const fresh = (await ingest({ externalId: "t3_fresh", now: new Date().toISOString() })).id!;
    await db.query(
      "insert into public.product_posts (product_id, post_id, relevance, category, reason, created_at) values ($1, $3, 80, 'wish', 'r', now() - interval '2 days'), ($2, $3, 80, 'wish', 'r', now()), ($1, $4, 80, 'wish', 'r', now())",
      [bob, alice, shared, fresh],
    );
    const from = new Date(Date.now() - 80 * 3600_000).toISOString();
    const to = new Date(Date.now() - 64 * 3600_000).toISOString();
    const products = await asService(() =>
      rows<{ id: string }>("select id from public.reddit_recheck_products($1, $2)", [from, to]),
    );
    expect(products.map((r) => r.id)).toEqual([bob]);
    const posts = await asService(() =>
      rows<{ external_id: string }>(
        "select external_id from public.reddit_recheck_posts($1, $2, $3, 10)",
        [bob, from, to],
      ),
    );
    expect(posts.map((p) => p.external_id)).toEqual(["t3_shared"]);
  });
});

describe("access to the new functions", () => {
  it.each([
    "select public.reserve_job_budget(gen_random_uuid(), gen_random_uuid(), 'reddit', current_date, 1, 1, null)",
    "select public.settle_job_budget(gen_random_uuid(), 1, 0)",
    "select * from public.collectable_products()",
    "select public.record_term_stats(gen_random_uuid(), current_date, 'reddit', '[]')",
    "select * from public.collect_terms(gen_random_uuid(), 'reddit', 1)",
    "select * from public.reddit_recheck_products(now(), now())",
    "select * from public.reddit_recheck_posts(gen_random_uuid(), now(), now(), 1)",
    "select public.delete_posts_at_source('reddit', array['x'])",
  ])("refuses anon and authenticated: %s", async (sql) => {
    await expect(withRole(db, "anon", null, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
    await expect(asAlice(() => db.query(sql))).rejects.toThrow(/permission denied for function/);
  });
});

describe("delete_posts_at_source (deletion sync)", () => {
  it("deletes the given posts of one source only and returns the count", async () => {
    await ingest({ externalId: "gone" });
    await ingest({ externalId: "kept" });
    await ingest({ source: "hackernews", externalId: "gone" });
    const n = await asService(() =>
      one<{ n: number }>("select public.delete_posts_at_source('reddit', array['gone']) as n"),
    );
    expect(n.n).toBe(1);
    expect(
      (
        await rows<{ k: string }>(
          "select source || ':' || external_id as k from public.posts order by 1",
        )
      ).map((r) => r.k),
    ).toEqual(["hackernews:gone", "reddit:kept"]);
  });
});

describe("review fixes", () => {
  it("stores an error class only, never a message (planted)", async () => {
    const { id } = await one<{ id: string }>(
      "insert into public.jobs (kind, status, locked_until) values ('purge', 'running', now() + interval '1 hour') returning id",
    );
    for (const message of [
      "Error: post by someone at https://www.reddit.com/r/SaaS/",
      "budget exceeded",
      "x".repeat(121),
    ])
      await expect(
        asService(() =>
          db.query("select public.finish_job($1, 'failed', $2, null, null)", [id, message]),
        ),
      ).rejects.toThrow(/jobs_last_error_check/);
    for (const name of ["TypeError", "LeaseExpired", "monthly_cap"])
      await asService(() =>
        db.query("select public.finish_job($1, 'failed', $2, null, null)", [id, name]),
      );
  });

  it("keeps a job payload an object", async () => {
    await expect(
      db.query("insert into public.jobs (kind, payload) values ('purge', '[1]')"),
    ).rejects.toThrow(/jobs_payload_check/);
  });

  it("never links a stored post that is past its retention", async () => {
    const first = await ingest({ externalId: "t3_old", now: "2026-10-01T00:00:00Z" });
    expect(first.id).toBeTruthy();
    expect((await ingest({ externalId: "t3_old", now: "2026-10-09T00:00:00Z" })).id).toBeNull();
  });

  it("lets no API role but the service role execute any function in public", async () => {
    const open = await rows<{ fn: string; role: string }>(
      `select p.oid::regprocedure::text as fn, r.role
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
         cross join (values ('anon'), ('authenticated')) as r (role)
        where has_function_privilege(r.role, p.oid, 'execute')`,
    );
    // Functions written for a signed-in user on purpose, from earlier migrations.
    const forUsers = new Set<string>();
    expect(open.filter((o) => !forUsers.has(o.fn))).toEqual([]);
  });
});

describe("collection review fixes", () => {
  it("refuses to settle with a missing count instead of zeroing the ledger", async () => {
    await consumeRaw(alice, 10);
    await expect(
      asService(() =>
        db.query("select public.settle_budget($1, 'reddit', '2026-10-17', 10, null, 0)", [alice]),
      ),
    ).rejects.toThrow(/units must be given/);
  });

  it("counts the monthly cap over the month of the day charged", async () => {
    await db.query(
      "insert into public.usage_ledger (product_id, source, usage_date, reads) values ($1, 'reddit', '2026-09-30', 95), ($1, 'reddit', '2026-10-02', 95)",
      [bob],
    );
    const job = await one<{ id: string }>(
      "insert into public.jobs (kind, product_id, source) values ('collect', $1, 'reddit') returning id",
      [alice],
    );
    const r = await asService(() =>
      one<{ r: string }>(
        "select public.reserve_job_budget($1, $2, 'reddit', '2026-10-17', 10, 100, 100) as r",
        [job.id, alice],
      ),
    );
    expect(r.r).toBe("monthly_cap");
  });

  it("adds a term listed twice in one job's stats once, summed", async () => {
    const { id: termId } = await one<{ id: string }>(
      "insert into public.search_terms (product_id, term) values ($1, 'twice listed') returning id",
      [alice],
    );
    const job = await one<{ id: string }>(
      "insert into public.jobs (kind) values ('collect') returning id",
    );
    await asService(() =>
      db.query("select public.record_term_stats($1, '2026-10-17', 'hackernews', $2)", [
        job.id,
        JSON.stringify([
          { term_id: termId, fetched: 3, relevant: 1 },
          { term_id: termId, fetched: 2, relevant: 1 },
        ]),
      ]),
    );
    expect(
      await one("select fetched, relevant from public.term_stats where term_id = $1", [termId]),
    ).toEqual({ fetched: 5, relevant: 2 });
  });

  it("refuses to purge without a time", async () => {
    await expect(asService(() => db.query("select public.purge_expired(null)"))).rejects.toThrow(
      /needs a time/,
    );
  });
});

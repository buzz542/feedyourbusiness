import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, withRole } from "./harness";

/**
 * Migration `removal_form` (docs/PLAN.md 4.8, 6.8 removal part, 12.7): the removal form's columns,
 * its rate limit (5 per IP hash per day, atomic), and "Delete and suppress" in one statement: the
 * author's posts deleted, the author hash suppressed so it is never stored again, the request
 * closed and the audit log written. Service role only; removal_requests stays deny-all.
 */

const MIGRATION = "_removal_form";
const NOW = "2026-11-05T12:00:00.000Z";
const ALICE = "00000000-0000-4000-8000-0000000000a1";

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;
const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

const submit = (ip: string, link = "https://news.ycombinator.com/item?id=1", now = NOW) =>
  asService(
    async () =>
      (
        await one<{ id: string | null }>(
          "select public.submit_removal_request($1, 'hackernews', 'person@example.test', null, $2, $3, 5) as id",
          [link, ip, now],
        )
      ).id,
  );

async function ingest(externalId: string, author: string, source = "hackernews") {
  return asService(
    async () =>
      (
        await one<{ id: string | null }>(
          "select public.ingest_post($1, $2, $3, 'An invented post.', $4, $5, null, $4) as id",
          [source, externalId, `https://news.ycombinator.com/item?id=${externalId}`, NOW, author],
        )
      ).id,
  );
}

beforeAll(async () => {
  db = await createDb({ stopBefore: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1)", [ALICE]);
});
afterAll(async () => db?.close());

describe("submit_removal_request", () => {
  it("records the request with its due dates: 72 hours target, 30 days at most", async () => {
    const id = await submit("ip-a");
    const row = await one<{ target_at: Date; due_at: Date; source: string; status: string }>(
      "select target_at, due_at, source, status from public.removal_requests where id = $1",
      [id],
    );
    expect(row.status).toBe("received");
    expect(row.source).toBe("hackernews");
    expect(new Date(row.target_at).toISOString()).toBe("2026-11-08T12:00:00.000Z");
    expect(new Date(row.due_at).toISOString()).toBe("2026-12-05T12:00:00.000Z");
  });

  it("allows 5 a day per IP hash and refuses the sixth; another IP hash is not affected", async () => {
    for (let i = 0; i < 5; i++) expect(await submit("ip-b")).not.toBeNull();
    expect(await submit("ip-b")).toBeNull();
    expect(await submit("ip-c")).not.toBeNull();
  });

  it("refuses an unknown source and over-long fields", async () => {
    await expect(
      asService(() =>
        db.query(
          "select public.submit_removal_request('x', 'linkedin', 'a@example.test', null, 'ip-d', $1, 5)",
          [NOW],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asService(() =>
        db.query(
          "select public.submit_removal_request('x', 'reddit', 'a@example.test', $1, 'ip-d', $2, 5)",
          ["d".repeat(1001), NOW],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("remove_and_suppress", () => {
  it("deletes the author's posts, suppresses the hash, closes the request and audits, at once", async () => {
    await ingest("101", "hash-target");
    await ingest("102", "hash-target");
    await ingest("103", "hash-other");
    const request = await submit("ip-e", "https://news.ycombinator.com/item?id=101");
    const deleted = await asService(
      async () =>
        (
          await one<{ n: number }>(
            "select public.remove_and_suppress($1, 'hackernews', 'hash-target', 'admin:1', $2, '101') as n",
            [request, NOW],
          )
        ).n,
    );
    expect(deleted).toBe(2);
    expect(
      (await db.query("select external_id from public.posts order by external_id")).rows,
    ).toEqual([{ external_id: "103" }]);
    expect((await db.query("select source, author_hash from public.suppression")).rows).toEqual([
      { source: "hackernews", author_hash: "hash-target" },
    ]);
    expect(
      await one(
        "select status, handled_at is not null as handled, ip_hash from public.removal_requests where id = $1",
        [request],
      ),
    ).toEqual({ status: "removed", handled: true, ip_hash: null });
    expect(
      await one("select actor, action, target from public.audit_log order by id desc limit 1"),
    ).toEqual({ actor: "admin:1", action: "removal_deleted_and_suppressed", target: request });
  });

  it("the author is never stored again", async () => {
    expect(await ingest("104", "hash-target")).toBeNull();
  });

  it("refuses a request that is already closed, changing nothing", async () => {
    const request = await submit("ip-f");
    await asService(() =>
      db.query("select public.remove_and_suppress($1, 'hackernews', 'h2', 'admin:1', $2)", [
        request,
        NOW,
      ]),
    );
    await expect(
      asService(() =>
        db.query("select public.remove_and_suppress($1, 'hackernews', 'h3', 'admin:1', $2)", [
          request,
          NOW,
        ]),
      ),
    ).rejects.toThrow(/not open/);
    expect(
      (await db.query("select 1 from public.suppression where author_hash = 'h3'")).rows,
    ).toEqual([]);
  });
});

describe("remove_and_suppress by name, as PostgREST calls it", () => {
  it("works for a username request, which names no post (p_external_id left out)", async () => {
    await ingest("201", "hash-name");
    const request = await submit("ip-h", "u/someone");
    const deleted = await asService(
      async () =>
        (
          await one<{ n: number }>(
            `select public.remove_and_suppress(p_request_id => $1, p_source => 'hackernews',
             p_author_hash => 'hash-name', p_actor => 'admin:1', p_now => $2) as n`,
            [request, NOW],
          )
        ).n,
    );
    expect(deleted).toBe(1);
  });
});

describe("close_removal_request", () => {
  it("closes or rejects with an audit row and clears the IP hash", async () => {
    const request = await submit("ip-g");
    await asService(() =>
      db.query("select public.close_removal_request($1, 'closed', 'admin:1', $2)", [request, NOW]),
    );
    expect(
      await one("select status, ip_hash from public.removal_requests where id = $1", [request]),
    ).toEqual({ status: "closed", ip_hash: null });
    expect(await one("select action from public.audit_log order by id desc limit 1")).toEqual({
      action: "removal_closed",
    });
  });
});

describe("access", () => {
  it("every function is refused to anon and authenticated, and the table stays invisible", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      for (const sql of [
        "select public.submit_removal_request('x', 'reddit', 'a@example.test', null, 'ip', now(), 5)",
        "select public.remove_and_suppress(gen_random_uuid(), 'reddit', 'h', 'a', now())",
        "select public.close_removal_request(gen_random_uuid(), 'closed', 'a', now())",
      ])
        await expect(withRole(db, role, ALICE, () => db.query(sql))).rejects.toThrow();
      const rows = await withRole(
        db,
        role,
        ALICE,
        async () =>
          (await db.query("select id from public.removal_requests").catch(() => ({ rows: [] })))
            .rows,
      );
      expect(rows).toEqual([]);
    }
  });
});

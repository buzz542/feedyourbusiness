import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/**
 * The email send record (M5, src/server/email/supabase-digest.ts): a finished `jobs` row keyed
 * `sent:<job id>`, inserted only if absent, as the service role writes it. It is never claimed as
 * work, and the purge drops it with other finished jobs after 30 days.
 */

let db: PGlite;
const DAY = 86_400_000;

const claim = (key: string, at: Date) =>
  withRole(
    db,
    "service_role",
    null,
    async () =>
      (
        await db.query(
          `insert into public.jobs (kind, product_id, status, dedupe_key, payload, run_after, finished_at)
         values ('digest_daily', null, 'done', $1, '{"send_record": true}', $2, $2)
         on conflict (dedupe_key) do nothing returning id`,
          [key, at.toISOString()],
        )
      ).rows.length,
  );

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => db?.close());

describe("send record", () => {
  const now = new Date("2026-11-05T06:00:00Z");

  it("is written once and keeps the first attempt's time", async () => {
    expect(await claim("sent:job-1", now)).toBe(1);
    expect(await claim("sent:job-1", new Date(now.getTime() + 3_600_000))).toBe(0);
    expect(await claim("sent:job-2", now)).toBe(1);
    const first = await db.query<{ finished_at: Date }>(
      "select finished_at from public.jobs where dedupe_key = 'sent:job-1'",
    );
    expect(new Date(first.rows[0]!.finished_at).toISOString()).toBe(now.toISOString());
  });

  it("is never claimed as work", async () => {
    const claimed = await withRole(
      db,
      "service_role",
      null,
      async () =>
        (await db.query("select * from public.claim_jobs($1, 10, 60)", [now.toISOString()])).rows,
    );
    expect(claimed).toEqual([]);
  });

  it("survives the purge for 30 days", async () => {
    await withRole(db, "service_role", null, () =>
      db.query("select public.purge_expired($1)", [
        new Date(now.getTime() + 29 * DAY).toISOString(),
      ]),
    );
    const left = await db.query("select id from public.jobs where dedupe_key like 'sent:%'");
    expect(left.rows).toHaveLength(2);
  });

  it("is invisible and unwritable to API roles", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      const rows = await withRole(
        db,
        role,
        null,
        async () => (await db.query("select id from public.jobs").catch(() => ({ rows: [] }))).rows,
      );
      expect(rows).toEqual([]);
      await expect(
        withRole(db, role, null, () =>
          db.query(
            "insert into public.jobs (kind, status, dedupe_key) values ('digest_daily', 'done', 'sent:x')",
          ),
        ),
      ).rejects.toThrow();
    }
  });

  it("is purged with other finished jobs after 30 days", async () => {
    await withRole(db, "service_role", null, () =>
      db.query("select public.purge_expired($1)", [
        new Date(now.getTime() + 31 * DAY).toISOString(),
      ]),
    );
    const left = await db.query("select id from public.jobs where dedupe_key like 'sent:%'");
    expect(left.rows).toEqual([]);
  });
});

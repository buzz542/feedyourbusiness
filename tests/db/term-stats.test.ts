import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `term_stats_once`: a collect job adds its per-term counts to `term_stats` exactly once,
 * so a job that crashes after writing them and runs again never counts twice (docs/PLAN.md 7.3
 * step 9). Counts from different jobs on the same day add up.
 */

const MIGRATION = migrationNamed("term_stats_once");
const ALICE = "00000000-0000-4000-8000-0000000000a1";

let db: PGlite;
let product = "";
let termA = "";
let termB = "";

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;

const newJob = async () =>
  (
    await one<{ id: string }>(
      "insert into public.jobs (kind, product_id, source) values ('collect', $1, 'hackernews') returning id",
      [product],
    )
  ).id;

const record = (job: string, stats: { term_id: string; fetched: number; relevant: number }[]) =>
  asService(() =>
    one<{ r: boolean }>(
      "select public.record_term_stats($1, '2026-10-17', 'hackernews', $2::jsonb) as r",
      [job, JSON.stringify(stats)],
    ),
  ).then((x) => x.r);

const stats = async () =>
  (
    await db.query<{ term_id: string; fetched: number; relevant: number }>(
      "select term_id, fetched, relevant from public.term_stats order by fetched desc",
    )
  ).rows;

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
  const term = async (text: string) =>
    (
      await one<{ id: string }>(
        "insert into public.search_terms (product_id, term) values ($1, $2) returning id",
        [product, text],
      )
    ).id;
  termA = await term("invoice tool");
  termB = await term("late fees");
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query("delete from public.term_stats");
  await db.query("delete from public.jobs");
});

describe("record_term_stats", () => {
  it("adds a job's counts once; a second call for the same job changes nothing", async () => {
    const job = await newJob();
    const counts = [
      { term_id: termA, fetched: 12, relevant: 3 },
      { term_id: termB, fetched: 4, relevant: 0 },
    ];
    expect(await record(job, counts)).toBe(true);
    expect(await record(job, counts)).toBe(false);
    expect(await stats()).toEqual([
      { term_id: termA, fetched: 12, relevant: 3 },
      { term_id: termB, fetched: 4, relevant: 0 },
    ]);
    const payload = await one<{ payload: Record<string, unknown> }>(
      "select payload from public.jobs where id = $1",
      [job],
    );
    expect(payload.payload.stats_recorded).toBe(true);
  });

  it("adds up counts from different jobs on the same day", async () => {
    await record(await newJob(), [{ term_id: termA, fetched: 5, relevant: 1 }]);
    await record(await newJob(), [{ term_id: termA, fetched: 7, relevant: 2 }]);
    expect(await stats()).toEqual([{ term_id: termA, fetched: 12, relevant: 3 }]);
  });

  it("skips a term deleted since the run started, and refuses negative counts", async () => {
    const gone = "00000000-0000-4000-8000-00000000dead";
    expect(await record(await newJob(), [{ term_id: gone, fetched: 3, relevant: 1 }])).toBe(true);
    expect(await stats()).toEqual([]);
    await expect(
      record(await newJob(), [{ term_id: termA, fetched: -1, relevant: 0 }]),
    ).rejects.toThrow(/term_stats_fetched_check/);
  });

  it("does nothing for a job that does not exist", async () => {
    expect(
      await record("00000000-0000-4000-8000-000000000000", [
        { term_id: termA, fetched: 1, relevant: 1 },
      ]),
    ).toBe(false);
    expect(await stats()).toEqual([]);
  });

  it("is refused to anon and authenticated", async () => {
    const sql =
      "select public.record_term_stats(gen_random_uuid(), current_date, 'hackernews', '[]'::jsonb)";
    await expect(withRole(db, "anon", null, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
    await expect(withRole(db, "authenticated", ALICE, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
  });
});

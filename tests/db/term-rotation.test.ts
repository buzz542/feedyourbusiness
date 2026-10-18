import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `term_rotation` (docs/PLAN.md 7.3 step 2): a product's active terms for a source, least
 * recently collected first, so Reddit's 12 terms a day reach every term within a few days.
 */

const MIGRATION = migrationNamed("term_rotation");
const ALICE = "00000000-0000-4000-8000-0000000000a1";

let db: PGlite;
let product = "";
const terms: string[] = [];

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

const pick = (source: string, limit: number) =>
  asService(
    async () =>
      (
        await db.query<{ id: string; term: string }>(
          "select id, term from public.collect_terms($1, $2, $3)",
          [product, source, limit],
        )
      ).rows,
  );

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1)", [ALICE]);
  product = (
    await db.query<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://p.example.test', 'P') returning id",
      [ALICE],
    )
  ).rows[0]!.id;
  for (let i = 0; i < 30; i++) {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.search_terms (product_id, term, created_at) values ($1, $2, now() + make_interval(secs => $3)) returning id",
      [product, `term ${String(i).padStart(2, "0")}`, i],
    );
    terms.push(rows[0]!.id);
  }
  await db.query(
    "insert into public.search_terms (product_id, term, paused) values ($1, 'paused term', true)",
    [product],
  );
  await db.query(
    "insert into public.search_terms (product_id, term, active) values ($1, 'inactive term', false)",
    [product],
  );
});

beforeEach(async () => {
  await db.query("delete from public.term_stats");
});

afterAll(async () => {
  await db.close();
});

describe("collect_terms", () => {
  it("reaches every active term within three days at 12 terms a day", async () => {
    const seen = new Set<string>();
    for (const day of ["2026-10-15", "2026-10-16", "2026-10-17"]) {
      const chosen = await pick("reddit", 12);
      expect(chosen).toHaveLength(12);
      for (const t of chosen) {
        seen.add(t.id);
        await db.query(
          "insert into public.term_stats (term_id, source, day, fetched, relevant) values ($1, 'reddit', $2, 0, 0)",
          [t.id, day],
        );
      }
    }
    expect([...seen].sort()).toEqual([...terms].sort());
  });

  it("puts terms never collected for the source first, then the oldest, then creation order", async () => {
    await db.query(
      "insert into public.term_stats (term_id, source, day) values ($1, 'reddit', '2026-10-17'), ($2, 'reddit', '2026-10-10'), ($3, 'hackernews', '2026-10-17')",
      [terms[0], terms[1], terms[2]],
    );
    const chosen = (await pick("reddit", 30)).map((t) => t.id);
    // terms[2] was collected only for Hacker News, so for Reddit it is new.
    expect(chosen.slice(0, 28)).toEqual(terms.filter((_, i) => i !== 0 && i !== 1));
    expect(chosen.slice(28)).toEqual([terms[1], terms[0]]);
  });

  it("never returns paused or inactive terms, and gives free sources all of them", async () => {
    const all = await pick("hackernews", 40);
    expect(all).toHaveLength(30);
    expect(all.map((t) => t.term)).not.toContain("paused term");
    expect(all.map((t) => t.term)).not.toContain("inactive term");
  });

  it("is refused to anon and authenticated", async () => {
    const sql = "select * from public.collect_terms(gen_random_uuid(), 'reddit', 12)";
    await expect(withRole(db, "anon", null, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
    await expect(withRole(db, "authenticated", ALICE, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
  });
});

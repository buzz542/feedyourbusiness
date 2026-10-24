import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, withRole } from "./harness";

/**
 * Migration `onboarding` (docs/PLAN.md 6.2): the competitors table, new product and search-term
 * fields, one product per owner (D9), and the server-only llm_usage table.
 */

const ALICE = "00000000-0000-4000-8000-0000000002a1";
const BOB = "00000000-0000-4000-8000-0000000002b2";

let db: PGlite;
const ids: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] as T;
}

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const asBob = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", BOB, fn);
const asAnon = <T>(fn: () => Promise<T>) => withRole(db, "anon", null, fn);
const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

beforeAll(async () => {
  // Seed the old shape (competitors as a text array on products), then run the migration.
  db = await createDb({ before: "_onboarding" });
  await db.query(
    "insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'bob@example.test')",
    [ALICE, BOB],
  );
  ids.alice = (
    await one<{ id: string }>(
      `insert into public.products (owner_id, url, name, competitors)
       values ($1, 'https://alice.example.test', 'Alice App', '{Acme,Globex,Acme}') returning id`,
      [ALICE],
    )
  ).id;
  ids.bob = (
    await one<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://bob.example.test', 'Bob App') returning id",
      [BOB],
    )
  ).id;
  await db.query("insert into public.search_terms (product_id, term) values ($1, 'old term')", [
    ids.alice,
  ]);
  await applyMigrationsFrom(db, "_onboarding");
});

afterAll(async () => {
  await db.close();
});

describe("existing competitors move to the competitors table", () => {
  it("moves each name once, as a user competitor, before the array column is dropped", async () => {
    const { rows } = await db.query<{ name: string; origin: string }>(
      "select name, origin from public.competitors where product_id = $1 order by name",
      [ids.alice],
    );
    expect(rows).toEqual([
      { name: "Acme", origin: "user" },
      { name: "Globex", origin: "user" },
    ]);
  });

  it("drops products.competitors", async () => {
    const row = await one<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and table_name = 'products' and column_name = 'competitors'`,
    );
    expect(row.n).toBe(0);
  });
});

describe("one product per owner (D9)", () => {
  it("refuses a second product for the same owner", async () => {
    await expect(
      asAlice(() =>
        db.query(
          "insert into public.products (owner_id, url, name) values ($1, 'https://alice2.example.test', 'Second')",
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/products_one_per_owner|duplicate key/);
  });
});

describe("products: new fields", () => {
  it("defaults the threshold to 60, with no one-liner, subreddits or confirmation", async () => {
    expect(
      await one(
        "select one_liner, subreddits, confirmed_at, relevance_threshold from public.products where id = $1",
        [ids.bob],
      ),
    ).toEqual({ one_liner: null, subreddits: [], confirmed_at: null, relevance_threshold: 60 });
  });

  it("the owner can set them", async () => {
    await asBob(() =>
      db.query(
        `update public.products set one_liner = 'CRM for tiny teams', subreddits = '{SaaS,startups}',
           relevance_threshold = 70 where id = $1`,
        [ids.bob],
      ),
    );
    expect(
      await one("select relevance_threshold from public.products where id = $1", [ids.bob]),
    ).toEqual({ relevance_threshold: 70 });
  });

  it.each([
    ["a threshold below 40", "relevance_threshold = 39"],
    ["a threshold above 95", "relevance_threshold = 96"],
    ["a one-liner over 160 characters", `one_liner = '${"x".repeat(161)}'`],
    ["more than 10 subreddits", `subreddits = '{a,b,c,d,e,f,g,h,i,j,k}'`],
  ])("refuses %s", async (_label, set) => {
    await expect(
      asBob(() => db.query(`update public.products set ${set} where id = $1`, [ids.bob])),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("search_terms: intent and pause", () => {
  it("existing and new terms default to the problem intent, not paused", async () => {
    expect(
      await one("select intent, paused from public.search_terms where term = 'old term'"),
    ).toEqual({ intent: "problem", paused: false });
    await asBob(() =>
      db.query("insert into public.search_terms (product_id, term) values ($1, 'new term')", [
        ids.bob,
      ]),
    );
    expect(
      await one("select intent, paused from public.search_terms where term = 'new term'"),
    ).toEqual({ intent: "problem", paused: false });
  });

  it("accepts the four intents and nothing else", async () => {
    for (const intent of ["category", "alternative", "competitor", "problem"]) {
      await asBob(() =>
        db.query("update public.search_terms set intent = $1 where term = 'new term'", [intent]),
      );
    }
    await expect(
      asBob(() =>
        db.query("update public.search_terms set intent = 'spam' where term = 'new term'"),
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("competitors: row-level security", () => {
  it("has RLS on and gives anon nothing", async () => {
    const row = await one<{ rls: boolean; s: boolean; i: boolean }>(
      `select c.relrowsecurity as rls,
              has_any_column_privilege('anon', 'public.competitors', 'select') as s,
              has_any_column_privilege('anon', 'public.competitors', 'insert') as i
       from pg_class c where c.oid = 'public.competitors'::regclass`,
    );
    expect(row).toEqual({ rls: true, s: false, i: false });
    await expect(asAnon(() => db.query("select * from public.competitors"))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("the owner adds, reads, edits and removes their competitors", async () => {
    await asAlice(() =>
      db.query(
        `insert into public.competitors (product_id, name, domain, aliases)
         values ($1, 'Initech', 'initech.example', '{Initrode}')`,
        [ids.alice],
      ),
    );
    await asAlice(() =>
      db.query(
        "update public.competitors set name = 'Initech Inc', domain = 'initech.example', aliases = '{}' where product_id = $1 and name = 'Initech'",
        [ids.alice],
      ),
    );
    const names = await asAlice(
      async () =>
        (await db.query<{ name: string }>("select name from public.competitors order by name"))
          .rows,
    );
    expect(names.map((r) => r.name)).toEqual(["Acme", "Globex", "Initech Inc"]);
    const deleted = await asAlice(() =>
      db.query("delete from public.competitors where name = 'Initech Inc'"),
    );
    expect(deleted.affectedRows).toBe(1);
  });

  it("another user cannot see, add, edit or remove them", async () => {
    const seen = await asBob(
      async () =>
        (
          await db.query<{ id: string }>(
            "select id from public.competitors where product_id = $1",
            [ids.alice],
          )
        ).rows,
    );
    expect(seen).toEqual([]);
    await expect(
      asBob(() =>
        db.query("insert into public.competitors (product_id, name) values ($1, 'Sneaky')", [
          ids.alice,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
    const upd = await asBob(() =>
      db.query("update public.competitors set name = 'pwned' where product_id = $1", [ids.alice]),
    );
    const del = await asBob(() =>
      db.query("delete from public.competitors where product_id = $1", [ids.alice]),
    );
    expect(upd.affectedRows).toBe(0);
    expect(del.affectedRows).toBe(0);
  });

  it("the owner cannot move a competitor to another product or rewrite its origin", async () => {
    await expect(
      asAlice(() =>
        db.query("update public.competitors set product_id = $1 where name = 'Acme'", [ids.bob]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAlice(() => db.query("update public.competitors set origin = 'draft' where name = 'Acme'")),
    ).rejects.toThrow(/permission denied/i);
  });

  it.each([
    ["an empty name", "name", "''"],
    ["a name over 80 characters", "name", `'${"x".repeat(81)}'`],
    ["a domain with a scheme", "domain", "'https://acme.example'"],
    ["a domain with capitals", "domain", "'Acme.example'"],
    ["a bare word as a domain", "domain", "'acme'"],
    ["more than 10 aliases", "aliases", "'{a,b,c,d,e,f,g,h,i,j,k}'"],
  ])("refuses %s", async (_label, column, value) => {
    await expect(
      asAlice(() =>
        db.query(`update public.competitors set ${column} = ${value} where name = 'Acme'`),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("refuses a duplicate name on the same product", async () => {
    await expect(
      asAlice(() =>
        db.query("insert into public.competitors (product_id, name) values ($1, 'Acme')", [
          ids.alice,
        ]),
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("goes when the product goes", async () => {
    await db.query("insert into public.competitors (product_id, name) values ($1, 'Hooli')", [
      ids.bob,
    ]);
    await db.query("delete from public.products where id = $1", [ids.bob]);
    const row = await one<{ n: number }>(
      "select count(*)::int as n from public.competitors where product_id = $1",
      [ids.bob],
    );
    expect(row.n).toBe(0);
  });
});

describe("llm_usage: server only", () => {
  it("is invisible and unwritable for anon and authenticated", async () => {
    for (const run of [asAnon, asAlice]) {
      await expect(run(() => db.query("select * from public.llm_usage"))).rejects.toThrow(
        /permission denied/i,
      );
    }
    for (const role of ["anon", "authenticated"]) {
      const row = await one<Record<string, boolean>>(
        `select has_any_column_privilege($1, 'public.llm_usage', 'select') as s,
                has_any_column_privilege($1, 'public.llm_usage', 'insert') as i,
                has_sequence_privilege($1, pg_get_serial_sequence('public.llm_usage', 'id'), 'usage') as q`,
        [role],
      );
      expect(row, role).toEqual({ s: false, i: false, q: false });
    }
  });

  it("has RLS on with an explicit deny-all policy", async () => {
    const row = await one<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.tablename = 'llm_usage'
                 and p.policyname = 'llm_usage_deny_all' and p.qual = 'false') as policies
       from pg_class c where c.oid = 'public.llm_usage'::regclass`,
    );
    expect(row).toEqual({ rls: true, policies: 1 });
  });

  it("the service role records a call with its tokens and cost", async () => {
    const row = await asService(() =>
      one<{ task: string; cost_usd: string }>(
        `insert into public.llm_usage (product_id, task, model, input_tokens, output_tokens, cost_usd)
         values ($1, 'draft', 'claude-sonnet-5-5', 1200, 400, 0.0064) returning task, cost_usd`,
        [ids.alice],
      ),
    );
    expect(row).toEqual({ task: "draft", cost_usd: "0.006400" });
  });

  it("refuses an unknown task", async () => {
    await expect(
      db.query(
        `insert into public.llm_usage (task, model, input_tokens, output_tokens, cost_usd)
         values ('reply', 'm', 1, 1, 0)`,
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

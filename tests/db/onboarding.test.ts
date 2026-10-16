import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/** Migration `onboarding` (docs/PLAN.md 6.2): competitors table, product fields, model usage. */

const MIGRATION = migrationNamed("onboarding");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const CAROL = "00000000-0000-4000-8000-0000000000c3";

let db: PGlite;
const ids: Record<string, string> = {};

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const asBob = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", BOB, fn);
const asAnon = <T>(fn: () => Promise<T>) => withRole(db, "anon", null, fn);
const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0] as T;
}

beforeAll(async () => {
  // Seed products with the old competitors array, then run this and every later migration.
  db = await createDb({ before: MIGRATION });
  await db.query("insert into auth.users (id) values ($1), ($2), ($3)", [ALICE, BOB, CAROL]);
  ids.alice = (
    await one<{ id: string }>(
      `insert into public.products (owner_id, url, name, competitors)
       values ($1, 'https://alice.example.test', 'Invoicer',
               array['Ledgerly', 'Billwise', 'Ledgerly', ' ledgerly ', '', null, repeat('x', 90)])
       returning id`,
      [ALICE],
    )
  ).id;
  ids.carol = (
    await one<{ id: string }>(
      `insert into public.products (owner_id, url, name, status, competitors)
       values ($1, 'https://carol.example.test', 'Scheduly', 'active', '{"Calendo"}')
       returning id`,
      [CAROL],
    )
  ).id;
  await applyMigrationsFrom(db, MIGRATION);
  ids.bob = (
    await one<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://bob.example.test', 'Crmly') returning id",
      [BOB],
    )
  ).id;
});

afterAll(async () => {
  await db.close();
});

describe("products", () => {
  it("moved each product's old competitors into the table, trimmed and deduplicated", async () => {
    const names = async (product: string) =>
      (
        await db.query<{ name: string; origin: string }>(
          "select name, origin from public.competitors where product_id = $1 order by name",
          [product],
        )
      ).rows;
    expect(await names(ids.alice!)).toEqual([
      { name: "Billwise", origin: "user" },
      { name: "Ledgerly", origin: "user" },
      { name: "x".repeat(80), origin: "user" },
    ]);
    expect(await names(ids.carol!)).toEqual([{ name: "Calendo", origin: "user" }]);
    const column = await db.query(
      "select 1 from information_schema.columns where table_name = 'products' and column_name = 'competitors'",
    );
    expect(column.rows).toEqual([]);
  });

  it("counts a product confirmed before confirmed_at existed as confirmed", async () => {
    const carol = await one<{ confirmed_at: Date | null }>(
      "select confirmed_at from public.products where id = $1",
      [ids.carol],
    );
    expect(carol.confirmed_at).not.toBeNull();
    const alice = await one<{ confirmed_at: Date | null }>(
      "select confirmed_at from public.products where id = $1",
      [ids.alice],
    );
    expect(alice.confirmed_at).toBeNull();
  });

  it("keeps one index per owner lookup (the old one is gone)", async () => {
    const { rows } = await db.query(
      "select indexname from pg_indexes where tablename = 'products' and indexname = 'products_owner_id_idx'",
    );
    expect(rows).toEqual([]);
  });

  it("has the new fields with their defaults", async () => {
    const row = await one<Record<string, unknown>>(
      "select one_liner, subreddits, confirmed_at, relevance_threshold from public.products where id = $1",
      [ids.bob],
    );
    expect(row).toEqual({
      one_liner: null,
      subreddits: [],
      confirmed_at: null,
      relevance_threshold: 60,
    });
  });

  it.each([
    [
      "relevance_threshold below 40",
      "update public.products set relevance_threshold = 39 where id = $1",
    ],
    [
      "relevance_threshold above 95",
      "update public.products set relevance_threshold = 96 where id = $1",
    ],
    [
      "a one-liner over 160 characters",
      `update public.products set one_liner = repeat('a', 161) where id = $1`,
    ],
    [
      "more than 10 subreddits",
      `update public.products set subreddits = array_fill('sub'::text, array[11]) where id = $1`,
    ],
    [
      "a profile as a subreddit",
      `update public.products set subreddits = '{"SaaS","u_someone"}' where id = $1`,
    ],
    [
      "a profile in upper case",
      `update public.products set subreddits = '{"U_someone"}' where id = $1`,
    ],
    [
      "a subreddit with odd characters",
      `update public.products set subreddits = '{"r/SaaS"}' where id = $1`,
    ],
    ["an empty subreddit", `update public.products set subreddits = '{""}' where id = $1`],
    [
      "a null subreddit",
      `update public.products set subreddits = array[null]::text[] where id = $1`,
    ],
  ])("refuses %s", async (_label, sql) => {
    await expect(db.query(sql, [ids.bob])).rejects.toThrow(/check/i);
  });

  it("accepts plain subreddit names", async () => {
    await db.query(
      `update public.products set subreddits = '{"SaaS","indiehackers","Entrepreneur_1"}' where id = $1`,
      [ids.bob],
    );
  });

  it("allows one product per owner (D9)", async () => {
    await expect(
      asBob(() =>
        db.query(
          "insert into public.products (owner_id, url, name) values ($1, 'https://second.example.test', 'Second')",
          [BOB],
        ),
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("search_terms", () => {
  it("defaults intent to problem and is not paused", async () => {
    const row = await one<{ intent: string; paused: boolean }>(
      "insert into public.search_terms (product_id, term) values ($1, 'looking for a crm') returning intent, paused",
      [ids.bob],
    );
    expect(row).toEqual({ intent: "problem", paused: false });
  });

  it("refuses an unknown intent", async () => {
    await expect(
      db.query(
        "insert into public.search_terms (product_id, term, intent) values ($1, 'x y', 'spam')",
        [ids.bob],
      ),
    ).rejects.toThrow(/check/i);
  });
});

describe("competitors", () => {
  it("the owner can add, read, edit and remove their competitors", async () => {
    const added = await asBob(
      async () =>
        (
          await db.query<{ id: string }>(
            `insert into public.competitors (product_id, name, domain, aliases, origin)
             values ($1, 'Pipely', 'pipely.example', '{"Pipe ly"}', 'draft') returning id`,
            [ids.bob],
          )
        ).rows[0]!.id,
    );
    await asBob(() =>
      db.query("update public.competitors set name = 'Pipely CRM', aliases = '{}' where id = $1", [
        added,
      ]),
    );
    const seen = await asBob(
      async () =>
        (
          await db.query<{ name: string }>("select name from public.competitors where id = $1", [
            added,
          ])
        ).rows,
    );
    expect(seen).toEqual([{ name: "Pipely CRM" }]);
    const removed = await asBob(() =>
      db.query("delete from public.competitors where id = $1", [added]),
    );
    expect(removed.affectedRows).toBe(1);
  });

  it("another user can neither see nor change them", async () => {
    const seen = await asBob(
      async () =>
        (await db.query("select * from public.competitors where product_id = $1", [ids.alice]))
          .rows,
    );
    expect(seen).toEqual([]);
    const updated = await asBob(() =>
      db.query("update public.competitors set name = 'Hacked' where product_id = $1", [ids.alice]),
    );
    expect(updated.affectedRows).toBe(0);
    const deleted = await asBob(() =>
      db.query("delete from public.competitors where product_id = $1", [ids.alice]),
    );
    expect(deleted.affectedRows).toBe(0);
    await expect(
      asBob(() =>
        db.query("insert into public.competitors (product_id, name) values ($1, 'Mine now')", [
          ids.alice,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("the owner cannot move a competitor or change its origin", async () => {
    const id = (
      await one<{ id: string }>("select id from public.competitors where product_id = $1 limit 1", [
        ids.alice,
      ])
    ).id;
    await expect(
      asAlice(() =>
        db.query("update public.competitors set product_id = $1 where id = $2", [ids.bob, id]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAlice(() => db.query("update public.competitors set origin = 'draft' where id = $1", [id])),
    ).rejects.toThrow(/permission denied/i);
  });

  it.each([
    ["a domain with a scheme", "https://x.example"],
    ["a domain with a path", "x.example/a"],
    ["an uppercase domain", "X.example"],
    ["a single-label domain", "localhost"],
  ])("refuses %s", async (_label, domain) => {
    await expect(
      db.query("insert into public.competitors (product_id, name, domain) values ($1, $2, $3)", [
        ids.bob,
        `Bad ${domain}`,
        domain,
      ]),
    ).rejects.toThrow(/check/i);
  });

  it.each(["Billwise", "billwise", " Billwise "])(
    "refuses %j, a duplicate name for the same product in any case",
    async (name) => {
      await expect(
        db.query("insert into public.competitors (product_id, name) values ($1, $2)", [
          ids.alice,
          name,
        ]),
      ).rejects.toThrow(/unique|duplicate/i);
    },
  );

  it.each([
    ["an empty alias", `'{""}'`],
    ["a blank alias", `'{"  "}'`],
    ["a null alias", "array[null]::text[]"],
    ["an alias over 80 characters", `array[repeat('a', 81)]`],
  ])("refuses %s", async (_label, aliases) => {
    await expect(
      db.query(
        `insert into public.competitors (product_id, name, aliases) values ($1, 'Aliasy', ${aliases})`,
        [ids.bob],
      ),
    ).rejects.toThrow(/check/i);
  });

  it("gives anon nothing: no read, add, edit or remove", async () => {
    for (const sql of [
      "select * from public.competitors",
      `insert into public.competitors (product_id, name) values ('${ids.bob}', 'Anon')`,
      "update public.competitors set name = 'x'",
      "delete from public.competitors",
    ])
      await expect(
        asAnon(() => db.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/i);
  });
});

describe("llm_usage", () => {
  it("records model usage from the service role", async () => {
    await asService(() =>
      db.query(
        `insert into public.llm_usage (product_id, task, model, input_tokens, output_tokens, cost_usd)
         values ($1, 'draft', 'claude-sonnet-5-5', 1000, 200, 0.004)`,
        [ids.bob],
      ),
    );
    const { rows } = await db.query("select task from public.llm_usage");
    expect(rows).toEqual([{ task: "draft" }]);
  });

  it.each([
    ["a negative cost", "-0.01", "1"],
    ["negative tokens", "0", "-1"],
  ])("refuses %s, which would let calls past a spend cap", async (_label, cost, tokens) => {
    await expect(
      db.query(
        `insert into public.llm_usage (task, model, input_tokens, output_tokens, cost_usd)
         values ('classify', 'm', ${tokens}, 1, ${cost})`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it("refuses an unknown task", async () => {
    await expect(
      db.query(
        "insert into public.llm_usage (task, model, input_tokens, output_tokens, cost_usd) values ('chat', 'm', 1, 1, 0)",
      ),
    ).rejects.toThrow(/check/i);
  });

  it("is invisible and unwritable for anon and authenticated", async () => {
    for (const as of [asAnon, asBob]) {
      await expect(as(() => db.query("select * from public.llm_usage"))).rejects.toThrow(
        /permission denied/i,
      );
      for (const sql of [
        "insert into public.llm_usage (task, model, input_tokens, output_tokens, cost_usd) values ('draft', 'm', 1, 1, 0)",
        "update public.llm_usage set cost_usd = 0",
        "delete from public.llm_usage",
      ])
        await expect(
          as(() => db.query(sql)),
          sql,
        ).rejects.toThrow(/permission denied/i);
    }
  });
});

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `profile_edit`: the onboarding review step (docs/PLAN.md 4.3) saves every edited field
 * in one transaction, and confirming makes the product active with confirmed_at.
 */

const MIGRATION = migrationNamed("profile_edit");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;
let alice = "";
let bob = "";
const ids: Record<string, string> = {};

const rows = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

const profile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "Invoicer",
    one_liner: "Invoices that chase themselves",
    description: "A small tool.",
    audience: "Freelancers",
    subreddits: ["freelance"],
    relevance_threshold: 70,
    ...over,
  });

const save = (as: string, product: string, p: string, terms: unknown[], competitors: unknown[]) =>
  withRole(db, "authenticated", as, () =>
    db.query("select public.save_product_profile($1, $2::jsonb, $3::jsonb, $4::jsonb)", [
      product,
      p,
      JSON.stringify(terms),
      JSON.stringify(competitors),
    ]),
  );

const confirm = (as: string, product: string) =>
  withRole(db, "authenticated", as, () =>
    db.query<{ confirmed_at: string }>("select public.confirm_product($1) as confirmed_at", [
      product,
    ]),
  );

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  const product = async (owner: string, url: string) =>
    (
      await rows<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, $2, 'host') returning id",
        [owner, url],
      )
    )[0]!.id;
  alice = await product(ALICE, "https://alice.example.test");
  bob = await product(BOB, "https://bob.example.test");
});

beforeEach(async () => {
  await db.query("delete from public.search_terms");
  await db.query("delete from public.competitors");
  await db.query("update public.products set status = 'draft', confirmed_at = null, name = 'host'");
  await db.query(
    `insert into public.search_terms (product_id, term, intent, paused) values
       ($1, 'keep me', 'problem', true), ($1, 'drop me', 'problem', false)`,
    [alice],
  );
  ids.ledgerly = (
    await rows<{ id: string }>(
      `insert into public.competitors (product_id, name, domain, origin)
       values ($1, 'Ledgerly', 'ledgerly.example', 'draft') returning id`,
      [alice],
    )
  )[0]!.id;
  ids.billwise = (
    await rows<{ id: string }>(
      "insert into public.competitors (product_id, name, origin) values ($1, 'Billwise', 'draft') returning id",
      [alice],
    )
  )[0]!.id;
});

afterAll(async () => {
  await db.close();
});

describe("save_product_profile", () => {
  it("saves every field, keeps unchanged terms (and their paused flag), adds and removes", async () => {
    await save(
      ALICE,
      alice,
      profile(),
      [
        { term: "keep me", intent: "category" },
        { term: "new term", intent: "problem" },
      ],
      [
        { id: ids.ledgerly, name: "Ledgerly Pro", domain: null, aliases: ["Ledgerly"] },
        { id: null, name: "Paidly", domain: "paidly.example", aliases: [] },
      ],
    );
    const [p] = await rows<Record<string, unknown>>(
      "select name, one_liner, description, audience, subreddits, relevance_threshold, status from public.products where id = $1",
      [alice],
    );
    expect(p).toEqual({
      name: "Invoicer",
      one_liner: "Invoices that chase themselves",
      description: "A small tool.",
      audience: "Freelancers",
      subreddits: ["freelance"],
      relevance_threshold: 70,
      status: "draft",
    });
    expect(
      await rows(
        "select term, intent, paused from public.search_terms where product_id = $1 order by term",
        [alice],
      ),
    ).toEqual([
      { term: "keep me", intent: "category", paused: true },
      { term: "new term", intent: "problem", paused: false },
    ]);
    expect(
      await rows(
        "select id, name, domain, aliases, origin from public.competitors where product_id = $1 order by name",
        [alice],
      ),
    ).toEqual([
      {
        id: ids.ledgerly,
        name: "Ledgerly Pro",
        domain: null,
        aliases: ["Ledgerly"],
        origin: "draft",
      },
      expect.objectContaining({
        name: "Paidly",
        domain: "paidly.example",
        aliases: [],
        origin: "user",
      }),
    ]);
  });

  it("rolls everything back when one part fails", async () => {
    await expect(
      save(
        ALICE,
        alice,
        profile({ name: "Changed" }),
        [{ term: "new", intent: "problem" }],
        [{ id: null, name: "x".repeat(81), domain: null, aliases: [] }],
      ),
    ).rejects.toThrow();
    expect(
      (await rows<{ name: string }>("select name from public.products where id = $1", [alice]))[0]!
        .name,
    ).toBe("host");
    expect(
      await rows("select term from public.search_terms where product_id = $1 order by term", [
        alice,
      ]),
    ).toEqual([{ term: "drop me" }, { term: "keep me" }]);
  });

  it("cannot touch another user's product or move a competitor between products", async () => {
    await expect(save(BOB, alice, profile({ name: "Mine" }), [], [])).rejects.toThrow(
      /no such product/,
    );
    const bobsRival = (
      await rows<{ id: string }>(
        "insert into public.competitors (product_id, name, origin) values ($1, 'Calendo', 'user') returning id",
        [bob],
      )
    )[0]!.id;
    // Alice names Bob's competitor id: it is neither updated nor deleted.
    await save(
      ALICE,
      alice,
      profile(),
      [],
      [{ id: bobsRival, name: "Stolen", domain: null, aliases: [] }],
    );
    expect(
      (
        await rows<{ name: string }>("select name from public.competitors where id = $1", [
          bobsRival,
        ])
      )[0]!.name,
    ).toBe("Calendo");
  });

  it("refuses more than 40 terms, 20 competitors or a threshold outside 40 to 95", async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ term: `t${i}`, intent: "problem" }));
    await expect(save(ALICE, alice, profile(), many, [])).rejects.toThrow(/too many/);
    const rivals = Array.from({ length: 21 }, (_, i) => ({
      id: null,
      name: `R${i}`,
      domain: null,
      aliases: [],
    }));
    await expect(save(ALICE, alice, profile(), [], rivals)).rejects.toThrow(/too many/);
    await expect(
      save(ALICE, alice, profile({ relevance_threshold: 96 }), [], []),
    ).rejects.toThrow();
  });
});

describe("confirm_product", () => {
  it("makes a draft with terms active and stamps confirmed_at", async () => {
    const result = await confirm(ALICE, alice);
    expect(result.rows[0]!.confirmed_at).toBeTruthy();
    const [p] = await rows<{ status: string; confirmed_at: string | null }>(
      "select status, confirmed_at from public.products where id = $1",
      [alice],
    );
    expect(p!.status).toBe("active");
    expect(p!.confirmed_at).not.toBeNull();
  });

  it("refuses a product with no active terms, another user's product, or one already confirmed", async () => {
    await db.query("delete from public.search_terms where product_id = $1", [alice]);
    await expect(confirm(ALICE, alice)).rejects.toThrow(/cannot confirm/);
    await db.query(
      "insert into public.search_terms (product_id, term, intent) values ($1, 'a term', 'problem')",
      [alice],
    );
    await expect(confirm(BOB, alice)).rejects.toThrow(/cannot confirm/);
    await confirm(ALICE, alice);
    await expect(confirm(ALICE, alice)).rejects.toThrow(/cannot confirm/);
  });

  it("is not callable by anon", async () => {
    await expect(
      withRole(db, "anon", null, () => db.query("select public.confirm_product($1)", [alice])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRole(db, "anon", null, () =>
        db.query("select public.save_product_profile($1, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)", [
          alice,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

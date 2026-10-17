import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/** Migration `save_draft`: the onboarding draft saved in one transaction (docs/PLAN.md 4.3, 8.3). */

const MIGRATION = migrationNamed("save_draft");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;
let alice = "";
let bob = "";

const terms = (n: number, prefix = "term") =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({ term: `${prefix} ${i + 1}`, intent: "problem" })),
  );

const save = (
  as: string,
  product: string,
  over: Partial<{ terms: string; competitors: string; subreddits: string[]; name: string }> = {},
) =>
  withRole(db, "authenticated", as, () =>
    db.query("select public.save_product_draft($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)", [
      product,
      "https://drafted.example.test/",
      over.name ?? "Invoicer",
      "Invoices that chase themselves",
      "A small tool for freelancers.",
      "Freelancers",
      over.subreddits ?? ["freelance", "smallbusiness"],
      over.terms ?? terms(22),
      over.competitors ??
        JSON.stringify([
          { name: "Ledgerly", domain: "ledgerly.example" },
          { name: "Billwise", domain: null },
        ]),
    ]),
  );

const rows = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

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
  await db.query("update public.products set status = 'draft', confirmed_at = null");
});

afterAll(async () => {
  await db.close();
});

describe("save_product_draft", () => {
  it("saves the profile, terms with their intent, and draft competitors", async () => {
    await save(ALICE, alice);
    const [p] = await rows<Record<string, unknown>>(
      "select url, name, one_liner, description, audience, subreddits, status from public.products where id = $1",
      [alice],
    );
    expect(p).toEqual({
      url: "https://drafted.example.test/",
      name: "Invoicer",
      one_liner: "Invoices that chase themselves",
      description: "A small tool for freelancers.",
      audience: "Freelancers",
      subreddits: ["freelance", "smallbusiness"],
      status: "draft",
    });
    const t = await rows<{ term: string; intent: string }>(
      "select term, intent from public.search_terms where product_id = $1",
      [alice],
    );
    expect(t).toHaveLength(22);
    expect(t[0]!.intent).toBe("problem");
    const c = await rows<{ name: string; domain: string | null; origin: string }>(
      "select name, domain, origin from public.competitors where product_id = $1 order by name",
      [alice],
    );
    expect(c).toEqual([
      { name: "Billwise", domain: null, origin: "draft" },
      { name: "Ledgerly", domain: "ledgerly.example", origin: "draft" },
    ]);
  });

  it("replaces an earlier draft's terms and draft competitors, and keeps the user's own", async () => {
    await save(ALICE, alice);
    await db.query(
      "insert into public.competitors (product_id, name, origin) values ($1, 'Mine', 'user')",
      [alice],
    );
    await save(ALICE, alice, {
      terms: terms(20, "second"),
      competitors: JSON.stringify([{ name: "Calendo", domain: null }]),
    });
    const t = await rows<{ term: string }>(
      "select term from public.search_terms where product_id = $1",
      [alice],
    );
    expect(t).toHaveLength(20);
    expect(t.every((r) => r.term.startsWith("second"))).toBe(true);
    const c = await rows<{ name: string }>(
      "select name from public.competitors where product_id = $1 order by name",
      [alice],
    );
    expect(c.map((r) => r.name)).toEqual(["Calendo", "Mine"]);
  });

  it("skips duplicate terms and competitors (case-insensitive names) instead of failing", async () => {
    await save(ALICE, alice, {
      terms: JSON.stringify([...JSON.parse(terms(20)), { term: "term 1", intent: "category" }]),
      competitors: JSON.stringify([
        { name: "Ledgerly", domain: null },
        { name: "ledgerly ", domain: null },
      ]),
    });
    expect(
      await rows("select 1 from public.search_terms where product_id = $1", [alice]),
    ).toHaveLength(20);
    expect(
      await rows("select 1 from public.competitors where product_id = $1 and origin = 'draft'", [
        alice,
      ]),
    ).toHaveLength(1);
  });

  it("refuses another user's product and changes nothing", async () => {
    await save(BOB, bob);
    await expect(save(ALICE, bob, { name: "Taken" })).rejects.toThrow(/not a draft product/);
    const [p] = await rows<{ name: string }>("select name from public.products where id = $1", [
      bob,
    ]);
    expect(p!.name).toBe("Invoicer");
  });

  it("refuses a confirmed product, in one transaction (terms untouched)", async () => {
    await save(ALICE, alice);
    await db.query(
      "update public.products set status = 'active', confirmed_at = now() where id = $1",
      [alice],
    );
    await expect(save(ALICE, alice, { terms: terms(25, "late") })).rejects.toThrow(
      /not a draft product/,
    );
    expect(
      await rows("select 1 from public.search_terms where product_id = $1 and term like 'late%'", [
        alice,
      ]),
    ).toHaveLength(0);
  });

  it("refuses more than 40 terms or 20 competitors", async () => {
    await expect(save(ALICE, alice, { terms: terms(41) })).rejects.toThrow(/too many/);
    await expect(
      save(ALICE, alice, {
        competitors: JSON.stringify(
          Array.from({ length: 21 }, (_, i) => ({ name: `R${i}`, domain: null })),
        ),
      }),
    ).rejects.toThrow(/too many/);
  });

  it("is not callable by anon", async () => {
    await expect(
      withRole(db, "anon", null, () =>
        db.query(
          "select public.save_product_draft($1, 'https://x.example.test', 'x', '', '', '', '{}', '[]'::jsonb, '[]'::jsonb)",
          [alice],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

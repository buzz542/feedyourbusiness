import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `products_lockdown`: owners write only their product's profile fields. Status and
 * confirmed_at change only through confirm_product() (and server code), and a product is deleted
 * only with its account, so a user cannot activate a product without confirming it, or reset the
 * per-product model spend cap by deleting and recreating it (docs/PLAN.md 4.3, 8.1).
 */

const MIGRATION = migrationNamed("products_lockdown");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;
let alice = "";

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  alice = (
    await asAlice(() =>
      one<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, 'https://alice.example.test', 'host') returning id",
        [ALICE],
      ),
    )
  ).id;
});

afterAll(async () => {
  await db.close();
});

describe("products grants", () => {
  it("lets the owner edit the profile fields", async () => {
    await asAlice(() =>
      db.query(
        `update public.products set url = 'https://alice.example.test/x', name = 'Invoicer',
           one_liner = 'a', description = 'b', audience = 'c', subreddits = '{"SaaS"}',
           relevance_threshold = 70 where id = $1`,
        [alice],
      ),
    );
    expect(
      await one<{ name: string }>("select name from public.products where id = $1", [alice]),
    ).toEqual({
      name: "Invoicer",
    });
  });

  it.each([
    ["activate it", "update public.products set status = 'active' where id = $1"],
    ["stamp confirmed_at", "update public.products set confirmed_at = now() where id = $1"],
    ["move it back to draft", "update public.products set status = 'draft' where id = $1"],
    ["change the owner", `update public.products set owner_id = '${BOB}' where id = $1`],
    ["delete it", "delete from public.products where id = $1"],
  ])("does not let the owner %s", async (_label, sql) => {
    await expect(asAlice(() => db.query(sql, [alice]))).rejects.toThrow(/permission denied/);
  });

  it("does not let a user create a product that is already active or confirmed", async () => {
    await db.query("delete from public.products where id = $1", [alice]);
    await expect(
      asAlice(() =>
        db.query(
          "insert into public.products (owner_id, url, name, status) values ($1, 'https://a.example.test', 'A', 'active')",
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAlice(() =>
        db.query(
          "insert into public.products (owner_id, url, name, confirmed_at) values ($1, 'https://a.example.test', 'A', now())",
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    alice = (
      await asAlice(() =>
        one<{ id: string }>(
          "insert into public.products (owner_id, url, name) values ($1, 'https://a.example.test', 'A') returning id",
          [ALICE],
        ),
      )
    ).id;
  });

  it("still confirms through confirm_product, for the owner only", async () => {
    await asAlice(() =>
      db.query(
        "insert into public.search_terms (product_id, term, intent) values ($1, 'chase invoices', 'problem')",
        [alice],
      ),
    );
    await expect(
      withRole(db, "authenticated", BOB, () =>
        db.query("select public.confirm_product($1)", [alice]),
      ),
    ).rejects.toThrow(/cannot confirm/);
    await asAlice(() => db.query("select public.confirm_product($1)", [alice]));
    expect(
      await one(
        "select status, confirmed_at is not null as confirmed from public.products where id = $1",
        [alice],
      ),
    ).toEqual({ status: "active", confirmed: true });
  });

  it("leaves the server (service role) able to change status and delete", async () => {
    await withRole(db, "service_role", null, async () => {
      await db.query("update public.products set status = 'paused' where id = $1", [alice]);
      await db.query("delete from public.products where id = $1", [alice]);
    });
    expect(
      await one("select count(*)::int as n from public.products where id = $1", [alice]),
    ).toEqual({
      n: 0,
    });
  });
});

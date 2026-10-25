import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed } from "./harness";

/** Migration `build_themes` (docs/PLAN.md 6.6): `kind` and `theme_key` constraints. */

const MIGRATION = migrationNamed("build_themes");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
let db: PGlite;
let product = "";

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1)", [ALICE]);
  product = (
    await db.query<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://x.example.test', 'P') returning id",
      [ALICE],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await db.close();
});

const theme = (kind: string | null, key: string | null, title = `t-${Math.random()}`) =>
  db.query(
    `insert into public.themes (product_id, week, title, summary, count, kind, theme_key)
     values ($1, '2026-10-19', $2, 'Our words.', 3, coalesce($3, 'ask'), $4)`,
    [product, title, kind, key],
  );

describe("themes kind and theme_key", () => {
  it.each(["ask", "wish", "pain", "opportunity", "rival_fix"])("accepts kind %s", async (kind) => {
    await theme(kind, "invoice-reminders");
  });

  it("defaults kind to ask", async () => {
    await theme(null, null, "defaulted");
    const { rows } = await db.query<{ kind: string }>(
      "select kind from public.themes where title = 'defaulted'",
    );
    expect(rows[0]!.kind).toBe("ask");
  });

  it.each(["praise", "Ask", ""])("refuses kind %j", async (kind) => {
    await expect(theme(kind, "x")).rejects.toThrow(/check constraint/);
  });

  it.each(["Invoice Reminders", "a_b", "x".repeat(61), "", "émoji"])(
    "refuses theme_key %j",
    async (key) => {
      await expect(theme("ask", key)).rejects.toThrow(/check constraint/);
    },
  );
});

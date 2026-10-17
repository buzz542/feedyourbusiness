import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/** Migration `llm_spend`: the spend sums behind the model spend caps (docs/PLAN.md 8.1). */

const MIGRATION = migrationNamed("llm_spend");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;
let alice = "";
let bob = "";

const spend = (
  role: "anon" | "authenticated" | "service_role",
  product: string | null,
  since: string,
) =>
  withRole(db, role, role === "authenticated" ? ALICE : null, async () =>
    Number(
      (
        await db.query<{ total: string }>(
          "select public.llm_spend_since($1::timestamptz, $2::uuid) as total",
          [since, product],
        )
      ).rows[0]!.total,
    ),
  );

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  const product = async (owner: string, url: string) =>
    (
      await db.query<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, $2, 'P') returning id",
        [owner, url],
      )
    ).rows[0]!.id;
  alice = await product(ALICE, "https://alice.example.test");
  bob = await product(BOB, "https://bob.example.test");
  const row = (productId: string | null, cost: number, at: string) =>
    db.query(
      `insert into public.llm_usage (product_id, task, model, input_tokens, output_tokens, cost_usd, created_at)
       values ($1, 'classify', 'claude-haiku-5-5', 1, 1, $2, $3)`,
      [productId, cost, at],
    );
  await row(alice, 1.25, "2026-09-30T23:59:59Z");
  await row(alice, 0.5, "2026-10-01T00:00:00Z");
  await row(alice, 0.25, "2026-10-16T08:00:00Z");
  await row(bob, 2, "2026-10-16T09:00:00Z");
  await row(null, 0.125, "2026-10-16T10:00:00Z");
});

afterAll(async () => {
  await db.close();
});

describe("llm_spend_since", () => {
  it("sums one product's spend from a moment on, inclusive", async () => {
    expect(await spend("service_role", alice, "2026-10-01T00:00:00Z")).toBeCloseTo(0.75, 6);
    expect(await spend("service_role", bob, "2026-10-01T00:00:00Z")).toBeCloseTo(2, 6);
  });

  it("sums every row, previews included, when no product is given", async () => {
    expect(await spend("service_role", null, "2026-10-16T00:00:00Z")).toBeCloseTo(2.375, 6);
  });

  it("returns 0 when nothing was spent", async () => {
    expect(await spend("service_role", alice, "2026-10-17T00:00:00Z")).toBe(0);
  });

  it("is for the server only", async () => {
    // The function's own grant refuses them, not just the table's.
    await expect(spend("authenticated", alice, "2026-10-01T00:00:00Z")).rejects.toThrow(
      /permission denied for function llm_spend_since/,
    );
    await expect(spend("anon", null, "2026-10-01T00:00:00Z")).rejects.toThrow(
      /permission denied for function llm_spend_since/,
    );
  });
});

describe("llm_spend_since plans", () => {
  it("uses the (product_id, created_at) index for one product's sum", async () => {
    // Enough rows that a sequential scan is not the cheaper plan.
    await db.query(
      `insert into public.llm_usage (product_id, task, model, input_tokens, output_tokens, cost_usd, created_at)
       select null, 'preview', 'claude-haiku-5-5', 1, 1, 0, now() - (g || ' minutes')::interval
       from generate_series(1, 5000) g`,
    );
    await db.query("analyze public.llm_usage");
    const plan = (
      await db.query<{ "QUERY PLAN": string }>(
        `explain select coalesce(sum(cost_usd), 0) from public.llm_usage
         where product_id = $1 and created_at >= $2`,
        [alice, "2026-10-01T00:00:00Z"],
      )
    ).rows
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    expect(plan).toMatch(/llm_usage_product_created_idx/);
    expect(await spend("service_role", alice, "2026-10-01T00:00:00Z")).toBeCloseTo(0.75, 6);
  });
});

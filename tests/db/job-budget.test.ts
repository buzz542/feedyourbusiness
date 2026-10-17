import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/**
 * Migration `job_budget`: a collect job reserves and settles its budget exactly once, atomically
 * with its own checkpoint, so a job that crashes and runs again never charges twice (7.2, 7.3).
 * And the daily enqueue's product list: confirmed, active, entitled.
 */

const MIGRATION = migrationNamed("job_budget");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const CAROL = "00000000-0000-4000-8000-0000000000c3";
const DANA = "00000000-0000-4000-8000-0000000000d4";

let db: PGlite;
let alice = "";
let job = "";

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T;

const reserve = (units: number, limit = 10, cap: number | null = null) =>
  asService(() =>
    one<{ r: string }>(
      "select public.reserve_job_budget($1, $2, 'reddit', '2026-10-17', $3, $4, $5, '2026-10-01') as r",
      [job, alice, units, limit, cap],
    ),
  ).then((x) => x.r);
const settle = (actual: number, cost: number) =>
  asService(() =>
    one<{ s: boolean }>("select public.settle_job_budget($1, $2, $3) as s", [job, actual, cost]),
  ).then((x) => x.s);
const ledger = () =>
  one<{ reads: number; cost_usd: string }>(
    "select reads, cost_usd from public.usage_ledger where product_id = $1 and source = 'reddit'",
    [alice],
  );

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2), ($3), ($4)", [
    ALICE,
    BOB,
    CAROL,
    DANA,
  ]);
  const product = async (owner: string, status: string, confirmed: boolean) =>
    (
      await one<{ id: string }>(
        "insert into public.products (owner_id, url, name, status, confirmed_at) values ($1, 'https://p.example.test', 'P', $2, $3) returning id",
        [owner, status, confirmed ? "2026-10-10T00:00:00Z" : null],
      )
    ).id;
  alice = await product(ALICE, "active", true);
  await product(BOB, "active", true); // not entitled
  await product(CAROL, "paused", true); // paused
  await product(DANA, "draft", false); // never confirmed
  await db.query(
    "update public.profiles set subscription_status = 'trialing' where id in ($1, $2, $3)",
    [ALICE, CAROL, DANA],
  );
  await db.query("update public.profiles set subscription_status = 'canceled' where id = $1", [
    BOB,
  ]);
});

beforeEach(async () => {
  await db.query("delete from public.usage_ledger");
  await db.query("delete from public.jobs");
  job = (
    await one<{ id: string }>(
      "insert into public.jobs (kind, product_id, source) values ('collect', $1, 'reddit') returning id",
      [alice],
    )
  ).id;
});

afterAll(async () => {
  await db.close();
});

describe("reserve_job_budget", () => {
  it("reserves once per job, however often the job runs", async () => {
    expect(await reserve(6)).toBe("reserved");
    expect(await reserve(6)).toBe("already");
    expect((await ledger()).reads).toBe(6);
    const { payload } = await one<{ payload: Record<string, unknown> }>(
      "select payload from public.jobs where id = $1",
      [job],
    );
    expect(payload).toMatchObject({ reserved: 6, day: "2026-10-17" });
  });

  it("refuses a reservation over the daily limit and records nothing", async () => {
    expect(await reserve(11)).toBe("refused");
    const { payload } = await one<{ payload: Record<string, unknown> }>(
      "select payload from public.jobs where id = $1",
      [job],
    );
    expect(payload).not.toHaveProperty("reserved");
  });

  it("refuses when the vendor's monthly cap would be crossed", async () => {
    await db.query(
      "insert into public.usage_ledger (product_id, source, usage_date, reads) values ($1, 'reddit', '2026-10-05', 95)",
      [alice],
    );
    expect(await reserve(6, 10, 100)).toBe("monthly_cap");
    expect(await reserve(5, 10, 100)).toBe("reserved");
  });
});

describe("settle_job_budget", () => {
  it("returns unused units and adds the cost, once", async () => {
    await reserve(8);
    expect(await settle(3, 0.0045)).toBe(true);
    expect(await settle(3, 0.0045)).toBe(false);
    expect(await ledger()).toEqual({ reads: 3, cost_usd: "0.0045" });
  });

  it("does nothing for a job that reserved nothing", async () => {
    expect(await settle(0, 0)).toBe(false);
  });
});

describe("collectable_products", () => {
  it("lists confirmed, active products whose owner is entitled", async () => {
    const rows = await asService(
      async () =>
        (await db.query<{ id: string }>("select id from public.collectable_products()")).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([alice]);
  });
});

describe("access", () => {
  it.each([
    "select public.reserve_job_budget(gen_random_uuid(), gen_random_uuid(), 'reddit', current_date, 1, 1, null, current_date)",
    "select public.settle_job_budget(gen_random_uuid(), 1, 0)",
    "select * from public.collectable_products()",
  ])("refuses anon and authenticated: %s", async (sql) => {
    await expect(withRole(db, "anon", null, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
    await expect(withRole(db, "authenticated", ALICE, () => db.query(sql))).rejects.toThrow(
      /permission denied for function/,
    );
  });
});

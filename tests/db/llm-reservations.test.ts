import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/**
 * Model call reservations (docs/PLAN.md 8.1, 8.3): every call reserves its place before it is made,
 * under one lock, so parallel requests cannot all pass the drafting limit or a spend cap on sums
 * read before any of them finished. The call then records its usage and drops the reservation in
 * one statement.
 */

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const NOW = "2026-10-29T12:00:00Z";
let db: PGlite;
let product = "";

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

const begin = (
  over: Partial<{
    product: string | null;
    now: string;
    taskCalls: number | null;
    monthly: number;
    daily: number;
    reserve: number;
  }> = {},
) =>
  asService(async () => {
    const { rows } = await db.query<{ status: string; reservation_id: string | null }>(
      "select * from public.llm_begin_call($1, 'draft', $2, $3, $4, $5, $6, 600)",
      [
        over.product === undefined ? product : over.product,
        over.now ?? NOW,
        over.taskCalls === undefined ? 6 : over.taskCalls,
        over.monthly ?? 3,
        over.daily ?? 25,
        over.reserve ?? 0.05,
      ],
    );
    return rows[0]!;
  });

const finish = (id: string, cost = 0.04, at = NOW) =>
  asService(() =>
    db.query(
      "select public.llm_finish_call($1, $2, 'draft', 'claude-sonnet-5-5', 8000, 2000, 0, 0, $3, $4)",
      [id, product, cost, at],
    ),
  );

beforeAll(async () => {
  db = await createDb();
  await db.query("insert into auth.users (id) values ($1)", [OWNER]);
  product = (
    await db.query<{ id: string }>(
      "insert into public.products (owner_id, name) values ($1, 'Acme') returning id",
      [OWNER],
    )
  ).rows[0]!.id;
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.query("delete from public.llm_reservations");
});

describe("llm_begin_call", () => {
  it("counts open reservations, so the seventh call of a day is refused before it is made", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await begin();
      expect(r.status).toBe("ok");
      ids.push(r.reservation_id!);
    }
    expect(await begin()).toEqual({ status: "task_daily", reservation_id: null });
    // Finishing a call keeps it counted, now as usage.
    await finish(ids[0]!);
    expect((await begin()).status).toBe("task_daily");
    // A new UTC day starts again.
    expect((await begin({ now: "2026-10-30T00:00:01Z" })).status).toBe("ok");
  });

  it("forgets a reservation whose lease ran out (a crashed call)", async () => {
    for (let i = 0; i < 5; i++) await begin({ now: "2026-10-29T13:00:00Z" });
    // Usage from the previous test makes six today; leases taken at 13:00 end at 13:10.
    expect((await begin({ now: "2026-10-29T13:05:00Z" })).status).toBe("task_daily");
    expect((await begin({ now: "2026-10-29T13:11:00Z" })).status).toBe("ok");
  });

  it("refuses at the product's monthly cap and the global daily cap, reservations included", async () => {
    await db.query("delete from public.llm_reservations");
    const other = { taskCalls: null, now: "2026-11-02T12:00:00Z" };
    expect((await begin({ ...other, monthly: 1, reserve: 0.6 })).status).toBe("ok");
    expect((await begin({ ...other, monthly: 1, reserve: 0.6 })).status).toBe("ok");
    expect((await begin({ ...other, monthly: 1, reserve: 0.6 })).status).toBe("product_monthly");
    expect((await begin({ ...other, product: null, daily: 1, reserve: 0.1 })).status).toBe(
      "global_daily",
    );
  });
});

describe("llm_finish_call", () => {
  it("writes one usage row and drops the reservation", async () => {
    const r = await begin({ now: "2026-12-01T12:00:00Z" });
    await finish(r.reservation_id!, 0.031, "2026-12-01T12:00:30Z");
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.llm_reservations where id = $1",
      [r.reservation_id],
    );
    expect(rows[0]!.n).toBe(0);
    const usage = await db.query<{ cost_usd: string }>(
      "select cost_usd from public.llm_usage where created_at = '2026-12-01T12:00:30Z'",
    );
    expect(usage.rows).toEqual([{ cost_usd: "0.031000" }]);
  });
});

describe("access", () => {
  it.each([
    "select * from public.llm_begin_call(null, 'draft', now(), null, 1, 1, 0, 60)",
    "select public.llm_finish_call(gen_random_uuid(), null, 'draft', 'm', 0, 0, 0, 0, 0, now())",
    "select * from public.llm_reservations",
  ])("refuses anon and authenticated: %s", async (sql) => {
    for (const role of ["anon", "authenticated"] as const)
      await expect(withRole(db, role, OWNER, () => db.query(sql))).rejects.toThrow(
        /permission denied/,
      );
  });
});

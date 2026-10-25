import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/** Migration `launch` (docs/PLAN.md 6.8): preview_runs expiry, every table deny-all for API roles. */

const MIGRATION = migrationNamed("launch");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
let db: PGlite;

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1)", [ALICE]);
});

afterAll(async () => {
  await db.close();
});

describe("preview_runs", () => {
  it("expires within 24 hours by default", async () => {
    const { rows } = await db.query<{ hours: number }>(
      `insert into public.preview_runs (ip_hash, url_host, result) values ('h', 'a.example.test', '{}')
       returning extract(epoch from (expires_at - created_at)) / 3600 as hours`,
    );
    expect(Number(rows[0]!.hours)).toBeCloseTo(24, 3);
  });

  it("refuses an expiry later than 24 hours", async () => {
    await expect(
      db.query(
        `insert into public.preview_runs (ip_hash, url_host, result, expires_at)
         values ('h', 'a.example.test', '{}', now() + interval '25 hours')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("caps the stored result size", async () => {
    await expect(
      db.query(
        "insert into public.preview_runs (ip_hash, url_host, result) values ('h', 'a.example.test', $1)",
        [JSON.stringify({ x: "y".repeat(30_000) })],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("is purged once expired", async () => {
    await db.query(
      `insert into public.preview_runs (ip_hash, url_host, result, created_at, expires_at)
       values ('old', 'a.example.test', '{}', now() - interval '2 days', now() - interval '1 day')`,
    );
    await withRole(db, "service_role", null, () => db.query("select public.purge_expired(now())"));
    const { rows } = await db.query("select 1 from public.preview_runs where ip_hash = 'old'");
    expect(rows).toHaveLength(0);
  });
});

describe("deny-all for API roles", () => {
  it.each([
    ["anon", null],
    ["authenticated", ALICE],
  ] as const)(
    "%s can neither read nor write preview_runs, removal_requests or sign_in_attempts",
    async (role, user) => {
      for (const table of ["preview_runs", "removal_requests", "sign_in_attempts"]) {
        await expect(
          withRole(db, role, user, () => db.query(`select * from public.${table}`)),
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        withRole(db, role, user, () =>
          db.query(
            "insert into public.removal_requests (link_or_handle, contact_email) values ('x', 'a@example.test')",
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("removal requests take the new fields, with their limits", async () => {
    await db.query(
      `insert into public.removal_requests (link_or_handle, contact_email, source, details, ip_hash)
       values ('https://news.ycombinator.com/item?id=1', 'a@example.test', 'hackernews', 'Please remove', 'h')`,
    );
    await expect(
      db.query(
        "insert into public.removal_requests (link_or_handle, contact_email, source) values ('x', 'a@example.test', 'linkedin')",
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        "insert into public.removal_requests (link_or_handle, contact_email, details) values ('x', 'a@example.test', $1)",
        ["d".repeat(1001)],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

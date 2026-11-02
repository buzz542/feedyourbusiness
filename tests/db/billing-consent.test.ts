import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, withRole } from "./harness";

/** Migration `billing_consent` (docs/PLAN.md 6.7): only the service role writes the consent time. */

const ALICE = "00000000-0000-4000-8000-0000000000a1";
let db: PGlite;

beforeAll(async () => {
  db = await createDb({ stopBefore: "_billing_consent" });
  await applyMigrationsFrom(db, "_billing_consent");
  await db.query("insert into auth.users (id) values ($1)", [ALICE]);
  await db.query("insert into public.profiles (id) values ($1) on conflict do nothing", [ALICE]);
});

afterAll(async () => {
  await db.close();
});

describe("service_consent_at", () => {
  it("cannot be written by the user or anon (planted)", async () => {
    await expect(
      withRole(db, "authenticated", ALICE, () =>
        db.query("update public.profiles set service_consent_at = now() where id = $1", [ALICE]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRole(db, "anon", null, () =>
        db.query("update public.profiles set service_consent_at = now()"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("is written by the service role and readable by its owner", async () => {
    await withRole(db, "service_role", null, () =>
      db.query(
        "update public.profiles set service_consent_at = '2026-11-02T12:00:00Z' where id = $1 and service_consent_at is null",
        [ALICE],
      ),
    );
    const row = await withRole(
      db,
      "authenticated",
      ALICE,
      async () =>
        (await db.query<{ at: Date }>("select service_consent_at as at from public.profiles")).rows,
    );
    expect(row.map((r) => r.at.toISOString())).toEqual(["2026-11-02T12:00:00.000Z"]);
  });
});

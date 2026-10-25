import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/** Migration `billing_consent` (docs/PLAN.md 6.7): only the service role writes service_consent_at. */

const MIGRATION = migrationNamed("billing_consent");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
let db: PGlite;

const consent = async () =>
  (
    await db.query<{ service_consent_at: Date | null }>(
      "select service_consent_at from public.profiles where id = $1",
      [ALICE],
    )
  ).rows[0]!.service_consent_at;

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1)", [ALICE]);
});

afterAll(async () => {
  await db.close();
});

describe("service_consent_at", () => {
  it("starts empty", async () => {
    expect(await consent()).toBeNull();
  });

  it("a user cannot write it", async () => {
    await expect(
      withRole(db, "authenticated", ALICE, () =>
        db.query("update public.profiles set service_consent_at = now() where id = $1", [ALICE]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(["anon", "authenticated"] as const)(
    "%s cannot call record_service_consent",
    async (role) => {
      await expect(
        withRole(db, role, role === "anon" ? null : ALICE, () =>
          db.query("select public.record_service_consent($1, now())", [ALICE]),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("the service role records it, moves it forward for a new consent, never back", async () => {
    const first = await withRole(db, "service_role", null, () =>
      db.query<{ ok: boolean }>(
        "select public.record_service_consent($1, '2026-10-25T10:00:00Z') as ok",
        [ALICE],
      ),
    );
    expect(first.rows[0]!.ok).toBe(true);
    const older = await withRole(db, "service_role", null, () =>
      db.query<{ ok: boolean }>(
        "select public.record_service_consent($1, '2026-09-01T10:00:00Z') as ok",
        [ALICE],
      ),
    );
    expect(older.rows[0]!.ok).toBe(false);
    expect((await consent())?.toISOString()).toBe("2026-10-25T10:00:00.000Z");
    const newer = await withRole(db, "service_role", null, () =>
      db.query<{ ok: boolean }>(
        "select public.record_service_consent($1, '2026-12-01T10:00:00Z') as ok",
        [ALICE],
      ),
    );
    expect(newer.rows[0]!.ok).toBe(true);
    expect((await consent())?.toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });
});

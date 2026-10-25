import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/** Migration `collection_pause` (docs/PLAN.md 4.7): owners pause and resume collection. */

const MIGRATION = migrationNamed("collection_pause");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
let db: PGlite;
let confirmed = "";
let draft = "";

const status = async (id: string) =>
  (await db.query<{ status: string }>("select status from public.products where id = $1", [id]))
    .rows[0]!.status;
const call = (as: string, id: string, paused: boolean) =>
  withRole(db, "authenticated", as, () =>
    db.query<{ s: string }>("select public.set_collection_paused($1, $2) as s", [id, paused]),
  );

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  confirmed = (
    await db.query<{ id: string }>(
      "insert into public.products (owner_id, url, name, status, confirmed_at) values ($1, 'https://a.example.test', 'A', 'active', now()) returning id",
      [ALICE],
    )
  ).rows[0]!.id;
  draft = (
    await db.query<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://b.example.test', 'B') returning id",
      [BOB],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await db.close();
});

describe("set_collection_paused", () => {
  it("the owner pauses and resumes a confirmed product", async () => {
    expect((await call(ALICE, confirmed, true)).rows[0]!.s).toBe("paused");
    expect(await status(confirmed)).toBe("paused");
    expect((await call(ALICE, confirmed, false)).rows[0]!.s).toBe("active");
  });

  it("another user cannot", async () => {
    await expect(call(BOB, confirmed, true)).rejects.toThrow(/cannot change collection/);
    expect(await status(confirmed)).toBe("active");
  });

  it("a draft cannot become active this way", async () => {
    await expect(call(BOB, draft, false)).rejects.toThrow(/cannot change collection/);
    expect(await status(draft)).toBe("draft");
  });

  it("anon cannot call it, and users still cannot write status directly", async () => {
    await expect(
      withRole(db, "anon", null, () =>
        db.query("select public.set_collection_paused($1, true)", [confirmed]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRole(db, "authenticated", ALICE, () =>
        db.query("update public.products set status = 'paused' where id = $1", [confirmed]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

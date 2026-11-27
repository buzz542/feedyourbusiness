import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/**
 * The product profile after setup (/app/product, the founder's redesign brief, 27 Nov 2026) saves
 * through the existing column grants and RLS, with no new migration: the owner updates the profile
 * columns of a confirmed product and adds or removes its search terms; nobody else can, and the
 * columns outside the grant stay closed.
 */

let seq = 0;
const newId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

describe("editing a confirmed product", () => {
  let db: PGlite;
  const as = <T>(user: string, fn: () => Promise<T>) => withRole(db, "authenticated", user, fn);

  async function confirmedOwner() {
    const user = newId();
    await db.query("insert into auth.users (id) values ($1)", [user]);
    const product = await as(user, async () => {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, 'https://p.example/', 'P') returning id",
        [user],
      );
      const id = rows[0]!.id;
      await db.query(
        "insert into public.search_terms (product_id, term, intent) values ($1, 'late invoices', 'problem'), ($1, 'Acme', 'competitor')",
        [id],
      );
      await db.query("update public.products set status = 'active' where id = $1", [id]);
      return id;
    });
    return { user, product };
  }

  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(() => db.close());

  it("lets the owner update every profile field the page shows", async () => {
    const { user, product } = await confirmedOwner();
    const { rows } = await as(user, () =>
      db.query<{ name: string; url: string; relevance_threshold: number; status: string }>(
        `update public.products set name = 'Renamed', url = 'https://new.example/',
           one_liner = 'One line', description = 'What it does', audience = 'Who it is for',
           relevance_threshold = 45
         where id = $1 returning name, url, relevance_threshold, status`,
        [product],
      ),
    );
    expect(rows).toEqual([
      { name: "Renamed", url: "https://new.example/", relevance_threshold: 45, status: "active" },
    ]);
  });

  it("keeps the database's own limits, such as the 40 to 95 minimum match", async () => {
    const { user, product } = await confirmedOwner();
    await expect(
      as(user, () =>
        db.query("update public.products set relevance_threshold = 20 where id = $1", [product]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("lets the owner add and remove search terms on a confirmed product", async () => {
    const { user, product } = await confirmedOwner();
    await as(user, async () => {
      await db.query("delete from public.search_terms where product_id = $1 and term = 'Acme'", [
        product,
      ]);
      await db.query(
        "insert into public.search_terms (product_id, term, intent) values ($1, 'chasing late payments', 'problem')",
        [product],
      );
    });
    const { rows } = await db.query<{ term: string }>(
      "select term from public.search_terms where product_id = $1 order by term",
      [product],
    );
    expect(rows.map((r) => r.term)).toEqual(["chasing late payments", "late invoices"]);
  });

  it("refuses another user's edits to the product and its terms", async () => {
    const { product } = await confirmedOwner();
    const { user: stranger } = await confirmedOwner();
    const updated = await as(stranger, () =>
      db.query("update public.products set name = 'Taken' where id = $1", [product]),
    );
    expect(updated.affectedRows).toBe(0);
    const removed = await as(stranger, () =>
      db.query("delete from public.search_terms where product_id = $1", [product]),
    );
    expect(removed.affectedRows).toBe(0);
    await expect(
      as(stranger, () =>
        db.query("insert into public.search_terms (product_id, term) values ($1, 'mine now')", [
          product,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps the columns outside the grant closed, such as the owner and confirmed_at", async () => {
    const { user, product } = await confirmedOwner();
    for (const set of [`owner_id = '${newId()}'`, "confirmed_at = now()"])
      await expect(
        as(user, () => db.query(`update public.products set ${set} where id = $1`, [product])),
      ).rejects.toThrow(/permission denied/);
  });
});

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, withRole } from "./harness";

/**
 * Migration `onboarding` (docs/PLAN.md 6.2): the competitors table, the new product fields, one
 * product per owner that the owner cannot delete (D9), search term intent, per-product caps, and
 * the server-only `llm_usage` table.
 */

let seq = 0;
const newId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

describe("moving products.competitors into the competitors table", () => {
  async function seeded(competitorsByOwner: string[][]): Promise<PGlite> {
    const db = await createDb({ stopBefore: "_onboarding" });
    for (const [i, competitors] of competitorsByOwner.entries()) {
      const owner = newId();
      await db.query("insert into auth.users (id) values ($1)", [owner]);
      await db.query(
        "insert into public.products (owner_id, url, name, competitors) values ($1, $2, $3, $4)",
        [owner, `https://p${i}.example`, `Product ${i}`, competitors],
      );
    }
    return db;
  }

  describe("with ordinary names", () => {
    let db: PGlite;
    const long = "L".repeat(81);

    beforeAll(async () => {
      db = await seeded([["Acme", " Beta ", "acme", "", "   ", long], []]);
      await applyMigrationsFrom(db, "_onboarding");
    });
    afterAll(() => db.close());

    it("keeps every name once, trimmed, cut to 80 characters, as a user competitor", async () => {
      const { rows } = await db.query<{ product: string; name: string; origin: string }>(
        `select p.name as product, c.name, c.origin
           from public.competitors c join public.products p on p.id = c.product_id
          order by lower(c.name)`,
      );
      expect(rows).toEqual([
        { product: "Product 0", name: "Acme", origin: "user" },
        { product: "Product 0", name: "Beta", origin: "user" },
        { product: "Product 0", name: "L".repeat(80), origin: "user" },
      ]);
    });

    it("drops the old array column", async () => {
      const { rows } = await db.query(
        `select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'products' and column_name = 'competitors'`,
      );
      expect(rows).toEqual([]);
    });
  });

  it("stops instead of dropping a name it cannot move", async () => {
    const db = await seeded([["Acme", "@somebody"]]);
    await expect(applyMigrationsFrom(db, "_onboarding")).rejects.toThrow(
      /1 of 2 existing competitor names could not be moved/,
    );
    await db.close();
  });

  it("stops instead of leaving a product with more than 20 competitors", async () => {
    const db = await seeded([Array.from({ length: 21 }, (_, i) => `Tool ${i}`)]);
    await expect(applyMigrationsFrom(db, "_onboarding")).rejects.toThrow(
      /more than 20 competitors/,
    );
    await db.close();
  });

  it("stamps a product that was confirmed by hand before the migration", async () => {
    const db = await seeded([["Acme"]]);
    await db.query("update public.products set status = 'active'");
    await applyMigrationsFrom(db, "_onboarding");
    const { rows } = await db.query<{ status: string; stamped: boolean }>(
      "select status, confirmed_at is not null as stamped from public.products",
    );
    expect(rows).toEqual([{ status: "active", stamped: true }]);
    await db.close();
  });

  it("stops when an owner already has two products", async () => {
    const db = await createDb({ stopBefore: "_onboarding" });
    const owner = newId();
    await db.query("insert into auth.users (id) values ($1)", [owner]);
    await db.query(
      `insert into public.products (owner_id, url, name)
       values ($1, 'https://a.example', 'A'), ($1, 'https://b.example', 'B')`,
      [owner],
    );
    await expect(applyMigrationsFrom(db, "_onboarding")).rejects.toThrow(/more than one product/);
    await db.close();
  });
});

describe("after the migration", () => {
  let db: PGlite;

  const as = <T>(user: string, fn: () => Promise<T>) => withRole(db, "authenticated", user, fn);
  const asAnon = <T>(fn: () => Promise<T>) => withRole(db, "anon", null, fn);
  const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

  /** A fresh user with one draft product, so no test depends on another's rows. */
  async function owner(url: string | null = "https://p.example") {
    const user = newId();
    await db.query("insert into auth.users (id) values ($1)", [user]);
    const { rows } = await as(user, () =>
      db.query<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, $2, 'Product') returning id",
        [user, url],
      ),
    );
    return { user, product: rows[0]!.id };
  }

  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(() => db.close());

  describe("products", () => {
    it("allows one product per owner (D9)", async () => {
      const { user } = await owner();
      await expect(
        as(user, () =>
          db.query(
            "insert into public.products (owner_id, url, name) values ($1, 'https://two.example', 'Two')",
            [user],
          ),
        ),
      ).rejects.toThrow(/products_one_per_owner/);
    });

    it("accepts no website yet, and still refuses http and empty URLs", async () => {
      const { user, product } = await owner(null);
      for (const url of ["http://p.example", ""]) {
        await expect(
          as(user, () =>
            db.query("update public.products set url = $1 where id = $2", [url, product]),
          ),
        ).rejects.toThrow(/products_url_check/);
      }
    });

    it("cannot be deleted by its owner, so usage limits never reset; the service role can", async () => {
      const { user, product } = await owner();
      await expect(
        as(user, () => db.query("delete from public.products where id = $1", [product])),
      ).rejects.toThrow(/permission denied/);
      const removed = await asService(() =>
        db.query("delete from public.products where id = $1", [product]),
      );
      expect(removed.affectedRows).toBe(1);
    });

    it("has the new fields with their defaults", async () => {
      const { user } = await owner();
      const { rows } = await as(user, () =>
        db.query(
          "select one_liner, subreddits, relevance_threshold, confirmed_at from public.products",
        ),
      );
      expect(rows).toEqual([
        { one_liner: null, subreddits: [], relevance_threshold: 60, confirmed_at: null },
      ]);
    });

    it.each([
      ["a 160 character one-liner", `one_liner = repeat('a', 160)`],
      ["a threshold of 40", "relevance_threshold = 40"],
      ["a threshold of 95", "relevance_threshold = 95"],
      ["10 subreddits", `subreddits = '{a1,a2,a3,a4,a5,a6,a7,a8,a9,a10}'`],
      [
        "subreddit names with underscores",
        `subreddits = '{side_project,ab,A23456789012345678901}'`,
      ],
    ])("accepts %s", async (_label, set) => {
      const { user, product } = await owner();
      const result = await as(user, () =>
        db.query(`update public.products set ${set} where id = $1`, [product]),
      );
      expect(result.affectedRows).toBe(1);
    });

    it.each([
      ["a 161 character one-liner", `one_liner = repeat('a', 161)`, /one_liner/],
      ["a threshold of 39", "relevance_threshold = 39", /relevance_threshold/],
      ["a threshold of 96", "relevance_threshold = 96", /relevance_threshold/],
      ["11 subreddits", `subreddits = array_fill('SaaS'::text, array[11])`, /subreddits/],
      ["a user's profile as a subreddit", `subreddits = '{SaaS,u_alice}'`, /subreddits/],
      ["a profile in capitals", `subreddits = '{U_Bob}'`, /subreddits/],
      ["a path", `subreddits = '{../user/x}'`, /subreddits/],
      ["a one-letter name", `subreddits = '{a}'`, /subreddits/],
      ["a 22 character name", `subreddits = '{A234567890123456789012}'`, /subreddits/],
      ["a null entry", `subreddits = array[null]::text[]`, /subreddits/],
      ["the same subreddit twice", `subreddits = '{SaaS,saas}'`, /subreddits/],
    ])("refuses %s", async (_label, set, error) => {
      const { user, product } = await owner();
      await expect(
        as(user, () => db.query(`update public.products set ${set} where id = $1`, [product])),
      ).rejects.toThrow(error);
    });
  });

  describe("confirmed_at", () => {
    const read = async (product: string) =>
      (
        await db.query<{ confirmed_at: Date | null; status: string; drift: number }>(
          `select confirmed_at, status,
                  abs(extract(epoch from (now() - confirmed_at)))::float as drift
             from public.products where id = $1`,
          [product],
        )
      ).rows[0]!;

    it("is stamped by the database, with its own clock, when the owner confirms", async () => {
      const { user, product } = await owner();
      await as(user, () =>
        db.query("update public.products set status = 'active' where id = $1", [product]),
      );
      const row = await read(product);
      expect(row.status).toBe("active");
      expect(row.drift).toBeLessThan(5);
    });

    it("is not writable by the owner at all", async () => {
      const { user, product } = await owner();
      for (const when of ["2000-01-01", "2999-01-01"]) {
        await expect(
          as(user, () =>
            db.query("update public.products set confirmed_at = $1 where id = $2", [when, product]),
          ),
        ).rejects.toThrow(/permission denied/);
      }
      expect((await read(product)).confirmed_at).toBeNull();
    });

    it("keeps the first stamp, even through the service role", async () => {
      const { user, product } = await owner();
      await as(user, () =>
        db.query("update public.products set status = 'active' where id = $1", [product]),
      );
      const stamped = (await read(product)).confirmed_at!.getTime();
      await asService(() =>
        db.query(
          "update public.products set confirmed_at = '2999-01-01', status = 'paused' where id = $1",
          [product],
        ),
      );
      expect((await read(product)).confirmed_at!.getTime()).toBe(stamped);
    });

    it("cannot go back to draft once confirmed", async () => {
      const { user, product } = await owner();
      await as(user, () =>
        db.query("update public.products set status = 'active' where id = $1", [product]),
      );
      await expect(
        as(user, () =>
          db.query("update public.products set status = 'draft' where id = $1", [product]),
        ),
      ).rejects.toThrow(/cannot go back to draft/);
    });

    it("is stamped when a product is inserted already confirmed", async () => {
      const user = newId();
      await db.query("insert into auth.users (id) values ($1)", [user]);
      const { rows } = await as(user, () =>
        db.query<{ id: string }>(
          `insert into public.products (owner_id, url, name, status)
           values ($1, null, 'P', 'active') returning id`,
          [user],
        ),
      );
      expect((await read(rows[0]!.id)).drift).toBeLessThan(5);
    });
  });

  describe("competitors", () => {
    const insert = (user: string, product: string, cols: string, values: string) =>
      as(user, () =>
        db.query(
          `insert into public.competitors (product_id, ${cols}) values ($1, ${values}) returning id`,
          [product],
        ),
      );

    it("the owner adds, reads, edits and removes them", async () => {
      const { user, product } = await owner();
      const { rows } = await as(user, () =>
        db.query<{ id: string }>(
          `insert into public.competitors (product_id, name, domain, aliases, origin)
           values ($1, 'Acme', 'acme.example', '{Acme Inc}', 'draft') returning id`,
          [product],
        ),
      );
      const id = rows[0]!.id;
      await as(user, () =>
        db.query("update public.competitors set name = 'Acme HQ', aliases = '{}' where id = $1", [
          id,
        ]),
      );
      const read = await as(user, () =>
        db.query("select name, domain, aliases, origin from public.competitors"),
      );
      expect(read.rows).toEqual([
        { name: "Acme HQ", domain: "acme.example", aliases: [], origin: "draft" },
      ]);
      const removed = await as(user, () =>
        db.query("delete from public.competitors where id = $1", [id]),
      );
      expect(removed.affectedRows).toBe(1);
    });

    it("another user cannot see, add to, edit or remove them", async () => {
      const alice = await owner();
      const bob = await owner();
      const { rows } = await insert(alice.user, alice.product, "name", "'Rival'");
      const id = (rows[0] as { id: string }).id;

      expect((await as(bob.user, () => db.query("select * from public.competitors"))).rows).toEqual(
        [],
      );
      await expect(insert(bob.user, alice.product, "name", "'Mine'")).rejects.toThrow(
        /row-level security/,
      );
      const edit = await as(bob.user, () =>
        db.query("update public.competitors set name = 'Taken' where id = $1", [id]),
      );
      expect(edit.affectedRows).toBe(0);
      const del = await as(bob.user, () =>
        db.query("delete from public.competitors where id = $1", [id]),
      );
      expect(del.affectedRows).toBe(0);
      expect(
        (await db.query("select name from public.competitors where id = $1", [id])).rows,
      ).toEqual([{ name: "Rival" }]);
    });

    it("the owner cannot move one to another product or change its origin", async () => {
      const alice = await owner();
      const bob = await owner();
      await insert(alice.user, alice.product, "name", "'Rival'");
      await expect(
        as(alice.user, () =>
          db.query("update public.competitors set product_id = $1", [bob.product]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(alice.user, () => db.query("update public.competitors set origin = 'discovered'")),
      ).rejects.toThrow(/permission denied/);
    });

    it.each([
      ["an 80 character name", "name", "repeat('n', 80)"],
      ["a name with a dot", "name", "'Cal.com'"],
      ["a name with a slash", "name", "'Menu/Tabs'"],
      ["a name starting with U", "name", "'U-Haul'"],
      ["a domain-like name", "name", "'Linear.app'"],
      ["a name with a dot and a space", "name", "'Monday.com Work OS'"],
      ["a name with an @-free slash", "name", "'Ops/Dev Kit'"],
      ["10 aliases", "name, aliases", "'A', '{a1,a2,a3,a4,a5,a6,a7,a8,a9,a10}'"],
      ["80 character aliases", "name, aliases", "'B', array[repeat('a', 80)]"],
      ["a domain", "name, domain", "'C', 'a-b.co.uk'"],
      ["an internationalized domain", "name, domain", "'C', 'xn--80ak6aa92e.xn--p1ai'"],
      [
        "a 253 character domain",
        "name, domain",
        `'D', repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 57) || '.com'`,
      ],
    ])("accepts %s", async (_label, cols, values) => {
      const { user, product } = await owner();
      await expect(insert(user, product, cols, values)).resolves.toBeTruthy();
    });

    it.each([
      ["an 81 character name", "name", "repeat('n', 81)", /competitors_name_check/],
      ["an empty name", "name", "''", /competitors_name_check/],
      ["a blank name", "name", "'   '", /competitors_name_check/],
      ["an @ handle", "name", "'@somebody'", /competitors_name_check/],
      ["a u/ handle", "name", "'u/bob_smith'", /competitors_name_check/],
      ["a handle inside a name", "name", "'Tool by u/bob'", /competitors_name_check/],
      ["an email address", "name", "'bob@example.com'", /competitors_name_check/],
      ["a URL", "name", "'https://acme.example'", /competitors_name_check/],
      ["a www address", "name", "'www.acme.example'", /competitors_name_check/],
      ["an X profile without a scheme", "name", "'x.com/alice'", /competitors_name_check/],
      ["a LinkedIn profile", "name", "'linkedin.com/in/alice'", /competitors_name_check/],
      ["a Reddit user page", "name", "'reddit.com/user/alice'", /competitors_name_check/],
      ["a GitHub profile", "name", "'github.com/alice'", /competitors_name_check/],
      ["a Bluesky profile link", "name", "'bsky.app/profile/alice'", /competitors_name_check/],
      ["a Bluesky handle", "name", "'alice.bsky.social'", /competitors_name_check/],
      ["a profile path", "name", "'user/alice'", /competitors_name_check/],
      ["a profile link as an alias", "name, aliases", "'A', array['x.com/alice']", /aliases/],
      ["11 aliases", "name, aliases", "'A', array_fill('a'::text, array[11])", /aliases/],
      ["a null alias", "name, aliases", "'A', array[null]::text[]", /aliases/],
      ["an empty alias", "name, aliases", "'A', array['']", /aliases/],
      ["an 81 character alias", "name, aliases", "'A', array[repeat('a', 81)]", /aliases/],
      ["a padded alias", "name, aliases", "'A', array['a' || repeat(' ', 1000)]", /aliases/],
      ["a padded name", "name", "' Acme'", /competitors_name_check/],
      ["a tab as a name", "name", "E'\\t'", /competitors_name_check/],
      ["a newline inside a name", "name", "E'Acme\\nInc'", /competitors_name_check/],
      [
        "a zero-width space in a handle",
        "name",
        "'u' || chr(8203) || '/jane'",
        /competitors_name_check/,
      ],
      ["a fullwidth @", "name", "chr(65312) || 'jane'", /competitors_name_check/],
      ["a fullwidth slash", "name", "'u' || chr(65295) || 'jane'", /competitors_name_check/],
      ["the same alias twice", "name, aliases", "'A', array['Acme', 'acme']", /aliases/],
      ["a t.me link", "name", "'t.me/jane'", /competitors_name_check/],
      ["a Bluesky handle as a domain", "name, domain", "'X', 'jane.bsky.social'", /domain/],
      ["a handle as an alias", "name, aliases", "'A', array['Acme', '@acme_founder']", /aliases/],
      ["an email as an alias", "name, aliases", "'A', array['ceo@acme.example']", /aliases/],
      ["a domain with a scheme", "name, domain", "'X', 'https://x.example'", /domain/],
      ["an uppercase domain", "name, domain", "'X', 'Y.example'", /domain/],
      ["an IP address as a domain", "name, domain", "'X', '169.254.169.254'", /domain/],
      ["a domain of hyphens", "name, domain", "'X', '-.-'", /domain/],
      ["a single-label domain", "name, domain", "'X', 'acme'", /domain/],
      ["a 64 character label", "name, domain", "'X', repeat('a', 64) || '.com'", /domain/],
      [
        "a 254 character domain",
        "name, domain",
        `'X', repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 58) || '.com'`,
        /domain/,
      ],
      ["an unknown origin", "name, origin", "'W', 'model'", /competitors_origin_check/],
    ])("refuses %s", async (_label, cols, values, error) => {
      const { user, product } = await owner();
      await expect(insert(user, product, cols, values)).rejects.toThrow(error);
    });

    it("treats names that differ only in case as the same competitor", async () => {
      const { user, product } = await owner();
      await insert(user, product, "name", "'Notion'");
      await expect(insert(user, product, "name", "'notion'")).rejects.toThrow(
        /competitors_product_name_key/,
      );
      // What supabase-js sends for upsert({ onConflict: "product_id,name_key", ignoreDuplicates }).
      const ignored = await as(user, () =>
        db.query(
          `insert into public.competitors (product_id, name) values ($1, 'NOTION'), ($1, 'Linear')
           on conflict (product_id, name_key) do nothing`,
          [product],
        ),
      );
      expect(ignored.affectedRows).toBe(1);
    });

    it("allows 20 per product and refuses the 21st, from any role", async () => {
      const { user, product } = await owner();
      for (let i = 1; i <= 20; i++) await insert(user, product, "name", `'Rival ${i}'`);
      await expect(insert(user, product, "name", "'Rival 21'")).rejects.toThrow(
        /at most 20 competitors/,
      );
      await expect(
        asService(() =>
          db.query("insert into public.competitors (product_id, name) values ($1, 'Rival 22')", [
            product,
          ]),
        ),
      ).rejects.toThrow(/at most 20 competitors/);
      // A duplicate at the cap is still a no-op, not a cap error.
      const again = await as(user, () =>
        db.query(
          `insert into public.competitors (product_id, name) values ($1, 'rival 1')
           on conflict (product_id, name_key) do nothing`,
          [product],
        ),
      );
      expect(again.affectedRows).toBe(0);
    });

    it("counts rows inserted earlier in the same statement", async () => {
      const { user, product } = await owner();
      const names = Array.from({ length: 21 }, (_, i) => `('Tool ${i}')`).join(", ");
      await expect(
        as(user, () =>
          db.query(
            `insert into public.competitors (product_id, name)
             select $1, n from (values ${names}) as t(n)`,
            [product],
          ),
        ),
      ).rejects.toThrow(/at most 20 competitors/);
      // Parallel inserts are serialized by a row lock on the product; PGlite has one connection,
      // so that half is not exercised here.
    });

    it("refuses handles from the service role too", async () => {
      const { product } = await owner();
      await expect(
        asService(() =>
          db.query("insert into public.competitors (product_id, name) values ($1, '@jane')", [
            product,
          ]),
        ),
      ).rejects.toThrow(/competitors_name_check/);
    });

    it("anon gets nothing", async () => {
      await expect(asAnon(() => db.query("select * from public.competitors"))).rejects.toThrow(
        /permission denied/,
      );
    });

    it("go when their product is deleted", async () => {
      const { user, product } = await owner();
      await insert(user, product, "name", "'Gone'");
      await asService(() => db.query("delete from public.products where id = $1", [product]));
      expect(
        (await db.query("select 1 from public.competitors where product_id = $1", [product])).rows,
      ).toEqual([]);
    });
  });

  describe("search_terms", () => {
    const addTerm = (user: string, product: string, term: string, intent?: string) =>
      as(user, () =>
        db.query(
          intent
            ? "insert into public.search_terms (product_id, term, intent) values ($1, $2, $3) returning intent, active"
            : "insert into public.search_terms (product_id, term) values ($1, $2) returning intent, active",
          intent ? [product, term, intent] : [product, term],
        ),
      );

    it("default to the problem intent and active (not paused)", async () => {
      const { user, product } = await owner();
      const { rows } = await addTerm(user, product, "how do I invoice");
      expect(rows).toEqual([{ intent: "problem", active: true }]);
    });

    it.each(["problem", "category", "alternative", "competitor"])(
      "accept the %s intent",
      async (intent) => {
        const { user, product } = await owner();
        await expect(addTerm(user, product, "a term", intent)).resolves.toBeTruthy();
      },
    );

    it("refuse an unknown intent", async () => {
      const { user, product } = await owner();
      await expect(addTerm(user, product, "x term", "brand")).rejects.toThrow(
        /search_terms_intent_check/,
      );
    });

    it("allow 40 per product and refuse the 41st, from any role", async () => {
      const { user, product } = await owner();
      for (let i = 1; i <= 40; i++) await addTerm(user, product, `term ${i}`);
      await expect(addTerm(user, product, "term 41")).rejects.toThrow(/at most 40 search terms/);
      await expect(
        asService(() =>
          db.query("insert into public.search_terms (product_id, term) values ($1, 'term 42')", [
            product,
          ]),
        ),
      ).rejects.toThrow(/at most 40 search terms/);
    });

    it.each([["alternative to Notion"], ["Cal.com alternative"], ["how do I send an invoice"]])(
      "accept the phrase %s",
      async (term) => {
        const { user, product } = await owner();
        await expect(addTerm(user, product, term)).resolves.toBeTruthy();
      },
    );

    it.each([
      ["an @ handle", "@janedoe"],
      ["a u/ handle", "u/janedoe"],
      ["an email address", "jane@acme.example"],
      ["a URL", "https://acme.example"],
      ["a profile link", "x.com/janedoe"],
      ["a Bluesky handle", "jane.bsky.social"],
    ])("refuse %s, so nobody is searched for by name", async (_label, term) => {
      const { user, product } = await owner();
      await expect(addTerm(user, product, term)).rejects.toThrow(/search_terms_term_is_a_phrase/);
    });
  });

  describe("llm_usage", () => {
    const insert = `insert into public.llm_usage
      (product_id, task, model, input_tokens, output_tokens, cost_usd)
      values ($1, $2, 'claude-sonnet-5-5', $3, 200, $4)`;

    it("the service role records a call", async () => {
      const { product } = await owner();
      await asService(() => db.query(insert, [product, "draft", 1000, 0.004]));
      const { rows } = await asService(() =>
        db.query(
          "select task, cache_read_tokens, cache_write_tokens, cost_usd from public.llm_usage where product_id = $1",
          [product],
        ),
      );
      expect(rows).toEqual([
        { task: "draft", cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: "0.004000" },
      ]);
    });

    it.each([
      ["an unknown task", ["chat", 10, 0], /llm_usage_task_check/],
      ["the research task, which v1 does not have", ["research", 10, 0], /llm_usage_task_check/],
      ["negative tokens", ["draft", -1, 0], /llm_usage_input_tokens_check/],
      ["a negative cost", ["draft", 10, -0.01], /llm_usage_cost_usd_check/],
    ])("refuses %s", async (_label, [task, tokens, cost], error) => {
      const { product } = await owner();
      await expect(
        asService(() => db.query(insert, [product, task, tokens, cost])),
      ).rejects.toThrow(error);
    });

    it("is invisible and unwritable for anon and authenticated", async () => {
      const { user, product } = await owner();
      for (const run of [asAnon, <T>(fn: () => Promise<T>) => as(user, fn)]) {
        await expect(run(() => db.query("select * from public.llm_usage"))).rejects.toThrow(
          /permission denied/,
        );
        await expect(run(() => db.query(insert, [product, "draft", 1, 0]))).rejects.toThrow(
          /permission denied/,
        );
      }
    });

    it("is append-only, even for the service role", async () => {
      const { product } = await owner();
      await asService(() => db.query(insert, [product, "draft", 1, 0]));
      for (const sql of [
        "update public.llm_usage set cost_usd = 0",
        "delete from public.llm_usage",
        "truncate public.llm_usage",
      ]) {
        await expect(asService(() => db.query(sql))).rejects.toThrow(/permission denied/);
      }
    });

    it("keeps the row when the product is deleted, without the product id", async () => {
      const { product } = await owner();
      await asService(() => db.query(insert, [product, "draft", 1, 0]));
      const before = await asService(() =>
        db.query<{ n: number }>(
          "select count(*)::int as n from public.llm_usage where product_id is null",
        ),
      );
      await asService(() => db.query("delete from public.products where id = $1", [product]));
      const after = await asService(() =>
        db.query<{ n: number }>(
          "select count(*)::int as n from public.llm_usage where product_id is null",
        ),
      );
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n + 1);
    });
  });

  describe("functions", () => {
    it.each([
      "private.are_product_labels(array['x'], 80)",
      "private.are_subreddit_names(array['x1'])",
    ])("anon cannot call %s", async (call) => {
      await expect(asAnon(() => db.query(`select ${call}`))).rejects.toThrow(/permission denied/);
    });

    it("the checks are outside the API's schema", async () => {
      const { rows } = await db.query(
        `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and proname in ('are_product_labels', 'are_subreddit_names')`,
      );
      expect(rows).toEqual([]);
    });

    it.each(["products_stamp_confirmed", "enforce_rows_per_product"])(
      "no API role can execute the trigger function %s",
      async (name) => {
        for (const role of ["anon", "authenticated"]) {
          const { rows } = await db.query<{ ok: boolean }>(
            `select has_function_privilege($1, 'public.${name}()', 'execute') as ok`,
            [role],
          );
          expect(rows[0]!.ok, role).toBe(false);
        }
      },
    );
  });
});

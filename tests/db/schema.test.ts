import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;
const ids: Record<string, string> = {};

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] as T;
}

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const asBob = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", BOB, fn);
const asAnon = <T>(fn: () => Promise<T>) => withRole(db, "anon", null, fn);
const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

beforeAll(async () => {
  db = await createDb();

  await db.query(
    "insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'bob@example.test')",
    [ALICE, BOB],
  );

  ids.aliceProduct = (
    await one<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://alice.example.test', 'Alice App') returning id",
      [ALICE],
    )
  ).id;
  ids.bobProduct = (
    await one<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://bob.example.test', 'Bob App') returning id",
      [BOB],
    )
  ).id;

  await db.query(
    "insert into public.search_terms (product_id, term) values ($1, 'invoice'), ($2, 'crm')",
    [ids.aliceProduct, ids.bobProduct],
  );

  ids.postForAlice = (
    await one<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash)
       values ('hackernews', 'hn-1', 'https://news.example.test/item?id=1', 'Anyone know an invoice tool?', now(), 'hash-a') returning id`,
    )
  ).id;
  ids.postForBob = (
    await one<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash)
       values ('bluesky', 'bsky-1', 'https://bsky.example.test/post/1', 'Need a CRM', now(), 'hash-b') returning id`,
    )
  ).id;
  ids.postForNobody = (
    await one<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash)
       values ('bluesky', 'bsky-2', 'https://bsky.example.test/post/2', 'Unmatched', now(), 'hash-c') returning id`,
    )
  ).id;

  ids.aliceMatch = (
    await one<{ id: string }>(
      `insert into public.product_posts (product_id, post_id, relevance, category, reason)
       values ($1, $2, 90, 'looking_for_tool', 'Asks for an invoice tool') returning id`,
      [ids.aliceProduct, ids.postForAlice],
    )
  ).id;
  ids.bobMatch = (
    await one<{ id: string }>(
      `insert into public.product_posts (product_id, post_id, relevance, category, reason)
       values ($1, $2, 80, 'pain_point', 'Wants a CRM') returning id`,
      [ids.bobProduct, ids.postForBob],
    )
  ).id;

  await db.query(
    `insert into public.themes (product_id, week, title, summary, count) values
     ($1, '2026-10-12', 'Invoice reminders', 'People want reminders', 4),
     ($2, '2026-10-12', 'CRM import', 'People want imports', 7)`,
    [ids.aliceProduct, ids.bobProduct],
  );
  await db.query(
    `insert into public.usage_ledger (product_id, source, reads, cost_usd) values ($1, 'bluesky', 10, 0), ($2, 'bluesky', 20, 0)`,
    [ids.aliceProduct, ids.bobProduct],
  );
  await db.query(
    `insert into public.suppression (author_hash, source, reason) values ('hash-z', 'bluesky', 'removal_request')`,
  );
  await db.query(
    `insert into public.removal_requests (link_or_handle, contact_email) values ('@someone', 'someone@example.test')`,
  );
  await db.query(
    `insert into public.audit_log (actor, action, target) values ('system', 'seed', 'test')`,
  );
  await db.query(
    `insert into public.billing_events (stripe_event_id, type) values ('evt_1', 'customer.subscription.updated')`,
  );
});

afterAll(async () => {
  await db.close();
});

describe("row-level security is on everywhere", () => {
  it("every public table has RLS enabled", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("anon holds no privilege on any public table", async () => {
    const { rows } = await db.query<{ relname: string; priv: string }>(
      `select c.relname, p.priv
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
       where n.nspname = 'public' and c.relkind = 'r'
         and has_table_privilege('anon', c.oid, p.priv)`,
    );
    expect(rows).toEqual([]);
  });

  it("API roles cannot execute the internal trigger functions", async () => {
    for (const fn of ["handle_new_user", "set_updated_at", "audit_log_is_append_only"]) {
      const row = await one<{ anon: boolean; authed: boolean }>(
        `select has_function_privilege('anon', 'public.${fn}()', 'execute') as anon,
                has_function_privilege('authenticated', 'public.${fn}()', 'execute') as authed`,
      );
      expect(row, fn).toEqual({ anon: false, authed: false });
    }
  });
});

describe("profiles", () => {
  it("are created automatically for every new auth user", async () => {
    const { rows } = await db.query("select id from public.profiles order by id");
    expect(rows.map((r) => (r as { id: string }).id)).toEqual([ALICE, BOB]);
  });

  it("a user reads only their own profile", async () => {
    const rows = await asAlice(
      async () => (await db.query<{ id: string }>("select id from public.profiles")).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([ALICE]);
  });

  it("a user can change their marketing preference", async () => {
    await asAlice(() =>
      db.query(
        "update public.profiles set marketing_opt_in = true, marketing_opt_in_at = now() where id = $1",
        [ALICE],
      ),
    );
    expect(
      (
        await one<{ marketing_opt_in: boolean }>(
          "select marketing_opt_in from public.profiles where id = $1",
          [ALICE],
        )
      ).marketing_opt_in,
    ).toBe(true);
  });

  it.each([
    ["plan", "update public.profiles set plan = 'pro' where id = $1"],
    [
      "subscription_status",
      "update public.profiles set subscription_status = 'active' where id = $1",
    ],
    [
      "stripe_customer_id",
      "update public.profiles set stripe_customer_id = 'cus_fake' where id = $1",
    ],
    ["trial_end", "update public.profiles set trial_end = now() + interval '1 year' where id = $1"],
    [
      "trial_reminder_sent_at",
      "update public.profiles set trial_reminder_sent_at = now() where id = $1",
    ],
  ])("a user cannot grant themselves billing state by writing %s", async (_column, sql) => {
    await expect(asAlice(() => db.query(sql, [ALICE]))).rejects.toThrow(/permission denied/i);
  });

  it("a user cannot update someone else's profile", async () => {
    const result = await asAlice(() =>
      db.query("update public.profiles set marketing_opt_in = true where id = $1", [BOB]),
    );
    expect(result.affectedRows).toBe(0);
  });

  it("a user cannot insert or delete profiles", async () => {
    await expect(
      asAlice(() => db.query("insert into public.profiles (id) values (gen_random_uuid())")),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAlice(() => db.query("delete from public.profiles where id = $1", [ALICE])),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("products and search terms", () => {
  it("a user sees only their own products", async () => {
    const rows = await asAlice(
      async () => (await db.query<{ id: string }>("select id from public.products")).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([ids.aliceProduct]);
  });

  it("a user can create a product they own, and it starts as a draft", async () => {
    // One product per account (D9), so this uses a user who has none yet.
    const DANA = "00000000-0000-4000-8000-0000000000d4";
    await db.query("insert into auth.users (id) values ($1)", [DANA]);
    const row = await withRole(db, "authenticated", DANA, async () =>
      one<{ status: string }>(
        "insert into public.products (owner_id, url, name) values ($1, 'https://dana.example.test', 'Dana') returning status",
        [DANA],
      ),
    );
    expect(row.status).toBe("draft");
  });

  it("a user cannot create a product owned by someone else", async () => {
    await expect(
      asAlice(() =>
        db.query(
          "insert into public.products (owner_id, url, name) values ($1, 'https://x.example.test', 'X')",
          [BOB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a user cannot hand their product to someone else", async () => {
    await expect(
      asAlice(() =>
        db.query("update public.products set owner_id = $1 where id = $2", [BOB, ids.aliceProduct]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a user cannot update or delete another user's product", async () => {
    const upd = await asAlice(() =>
      db.query("update public.products set name = 'pwned' where id = $1", [ids.bobProduct]),
    );
    const del = await asAlice(() =>
      db.query("delete from public.products where id = $1", [ids.bobProduct]),
    );
    expect(upd.affectedRows).toBe(0);
    expect(del.affectedRows).toBe(0);
  });

  it("refuses non-https product URLs", async () => {
    await expect(
      asAlice(() =>
        db.query(
          "insert into public.products (owner_id, url, name) values ($1, 'http://insecure.example.test', 'Nope')",
          [ALICE],
        ),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("search terms follow product ownership", async () => {
    const mine = await asAlice(
      async () => (await db.query<{ term: string }>("select term from public.search_terms")).rows,
    );
    expect(mine.map((r) => r.term)).toEqual(["invoice"]);

    await expect(
      asAlice(() =>
        db.query("insert into public.search_terms (product_id, term) values ($1, 'sneaky')", [
          ids.bobProduct,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);

    await asAlice(() =>
      db.query("insert into public.search_terms (product_id, term) values ($1, 'billing')", [
        ids.aliceProduct,
      ]),
    );
  });
});

describe("posts: third-party content", () => {
  it("a user sees only posts that matched one of their own products", async () => {
    const rows = await asAlice(
      async () => (await db.query<{ id: string }>("select id from public.posts")).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([ids.postForAlice]);
  });

  it("a user can never write, edit or delete posts", async () => {
    await expect(
      asAlice(() =>
        db.query(
          `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash)
           values ('bluesky', 'x', 'https://x.example.test/1', 'hi', now(), 'h')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAlice(() => db.query("update public.posts set excerpt = 'edited'")),
    ).rejects.toThrow(/permission denied/i);
    await expect(asAlice(() => db.query("delete from public.posts"))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("caps the excerpt at 280 characters", async () => {
    const insert = (len: number) =>
      db.query(
        `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash)
         values ('bluesky', $1, 'https://bsky.example.test/p', $2, now(), 'h')`,
        [`len-${len}`, "x".repeat(len)],
      );
    await expect(insert(280)).resolves.toBeDefined();
    await expect(insert(281)).rejects.toThrow(/check constraint/i);
  });

  it("deletes raw posts within 30 days: delete_after defaults to 30 days and can never exceed it", async () => {
    const row = await one<{ days: number }>(
      "select extract(epoch from (delete_after - collected_at)) / 86400 as days from public.posts where id = $1",
      [ids.postForAlice],
    );
    expect(Number(row.days)).toBeCloseTo(30, 1);

    await expect(
      db.query(
        `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash, delete_after)
         values ('bluesky', 'long-lived', 'https://bsky.example.test/p', 'x', now(), 'h', now() + interval '31 days')`,
      ),
    ).rejects.toThrow(/posts_retention_max_30_days/);
  });

  it("only allows the two collected sources", async () => {
    await expect(
      db.query(
        `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash)
         values ('reddit', 'r1', 'https://reddit.example.test/r1', 'x', now(), 'h')`,
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("stores each external post once", async () => {
    await expect(
      db.query(
        `insert into public.posts (source, external_id, url, excerpt, posted_at, author_hash)
         values ('hackernews', 'hn-1', 'https://news.example.test/item?id=1', 'dup', now(), 'h')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("has no avatar, bio, follower or email columns", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('posts', 'product_posts')`,
    );
    const names = rows.map((r) => r.column_name).join(",");
    expect(names).not.toMatch(/avatar|bio|follower|following|email|phone|photo|image/);
  });
});

describe("product_posts: the Reply tab", () => {
  it("a user sees only their own matches", async () => {
    const rows = await asAlice(
      async () => (await db.query<{ id: string }>("select id from public.product_posts")).rows,
    );
    expect(rows.map((r) => r.id)).toEqual([ids.aliceMatch]);
  });

  it("a user can mark their own match replied", async () => {
    await asAlice(() =>
      db.query("update public.product_posts set state = 'replied' where id = $1", [ids.aliceMatch]),
    );
    expect(
      (
        await one<{ state: string }>("select state from public.product_posts where id = $1", [
          ids.aliceMatch,
        ])
      ).state,
    ).toBe("replied");
  });

  it("a user cannot change scores, categories or reasons", async () => {
    await expect(
      asAlice(() =>
        db.query("update public.product_posts set relevance = 100 where id = $1", [ids.aliceMatch]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a user cannot change someone else's match", async () => {
    const result = await asAlice(() =>
      db.query("update public.product_posts set state = 'hidden' where id = $1", [ids.bobMatch]),
    );
    expect(result.affectedRows).toBe(0);
  });

  it("rejects an invalid state", async () => {
    await expect(
      asAlice(() =>
        db.query("update public.product_posts set state = 'archived' where id = $1", [
          ids.aliceMatch,
        ]),
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("themes and usage", () => {
  it("are readable only by the product owner and never writable by users", async () => {
    const themes = await asAlice(
      async () => (await db.query<{ title: string }>("select title from public.themes")).rows,
    );
    expect(themes.map((t) => t.title)).toEqual(["Invoice reminders"]);

    const usage = await asBob(
      async () => (await db.query<{ reads: number }>("select reads from public.usage_ledger")).rows,
    );
    expect(usage.map((u) => u.reads)).toEqual([20]);

    await expect(
      asAlice(() =>
        db.query(
          "insert into public.themes (product_id, week, title, summary, count) values ($1, '2026-10-19', 't', 's', 1)",
          [ids.aliceProduct],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAlice(() => db.query("update public.usage_ledger set reads = 0")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("keeps at most three example posts per theme", async () => {
    await expect(
      db.query(
        `insert into public.themes (product_id, week, title, summary, count, example_post_ids)
         values ($1, '2026-10-26', 'too many', 's', 4, array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])`,
        [ids.aliceProduct],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("server-only tables", () => {
  const tables = ["suppression", "removal_requests", "audit_log", "billing_events"];

  it.each(tables)(
    "%s is invisible and unwritable to anon and authenticated users",
    async (table) => {
      for (const run of [asAnon, asAlice]) {
        await expect(run(() => db.query(`select * from public.${table}`))).rejects.toThrow(
          /permission denied/i,
        );
        await expect(run(() => db.query(`delete from public.${table}`))).rejects.toThrow(
          /permission denied/i,
        );
      }
    },
  );

  it("the service role can use them", async () => {
    await asService(async () => {
      await db.query(
        `insert into public.suppression (author_hash, source, reason) values ('hash-y', 'hackernews', 'admin')`,
      );
      await db.query(
        `insert into public.removal_requests (link_or_handle, contact_email) values ('https://x.example.test/1', 'a@example.test')`,
      );
      const { rows } = await db.query("select count(*)::int as n from public.suppression");
      expect((rows[0] as { n: number }).n).toBeGreaterThanOrEqual(2);
    });
  });

  it("gives removal requests a 72 hour target and a 30 day deadline", async () => {
    const row = await one<{ target_h: number; due_d: number }>(
      `select extract(epoch from (target_at - created_at)) / 3600 as target_h,
              extract(epoch from (due_at - created_at)) / 86400 as due_d
       from public.removal_requests limit 1`,
    );
    expect(Number(row.target_h)).toBeCloseTo(72, 1);
    expect(Number(row.due_d)).toBeCloseTo(30, 1);
  });

  it("stores each suppressed author once per source", async () => {
    await expect(
      db.query(
        `insert into public.suppression (author_hash, source, reason) values ('hash-z', 'bluesky', 'again')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });
});

describe("audit log", () => {
  it("is append-only, even for the service role", async () => {
    await expect(
      asService(() => db.query("update public.audit_log set action = 'tampered'")),
    ).rejects.toThrow(/append-only/);
    await expect(asService(() => db.query("delete from public.audit_log"))).rejects.toThrow(
      /append-only/,
    );
  });

  it("accepts new entries", async () => {
    await asService(() =>
      db.query(
        "insert into public.audit_log (actor, action, target) values ('admin', 'removal', 'req-1')",
      ),
    );
  });
});

describe("account deletion", () => {
  it("removes a user's profile, products, matches, themes and usage in one delete", async () => {
    const CAROL = "00000000-0000-4000-8000-0000000000c3";
    await db.query("insert into auth.users (id, email) values ($1, 'carol@example.test')", [CAROL]);
    const product = await one<{ id: string }>(
      "insert into public.products (owner_id, url, name) values ($1, 'https://carol.example.test', 'Carol') returning id",
      [CAROL],
    );
    await db.query("insert into public.search_terms (product_id, term) values ($1, 'x')", [
      product.id,
    ]);
    await db.query(
      "insert into public.themes (product_id, week, title, summary, count) values ($1, '2026-10-12', 't', 's', 1)",
      [product.id],
    );
    await db.query("insert into public.usage_ledger (product_id, source) values ($1, 'bluesky')", [
      product.id,
    ]);

    await db.query("delete from auth.users where id = $1", [CAROL]);

    for (const [table, column] of [
      ["profiles", "id"],
      ["products", "owner_id"],
      ["search_terms", "product_id"],
      ["themes", "product_id"],
      ["usage_ledger", "product_id"],
    ] as const) {
      const value = column === "id" || column === "owner_id" ? CAROL : product.id;
      const { rows } = await db.query(`select 1 from public.${table} where ${column} = $1`, [
        value,
      ]);
      expect(rows, table).toEqual([]);
    }
  });
});

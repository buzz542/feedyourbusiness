import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/** Migration `profiles_app` (docs/PLAN.md 6.1): profile preferences, admin flag, events. */

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const asAnon = <T>(fn: () => Promise<T>) => withRole(db, "anon", null, fn);
const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);

beforeAll(async () => {
  db = await createDb();
  await db.query(
    "insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'bob@example.test')",
    [ALICE, BOB],
  );
});

afterAll(async () => {
  await db.close();
});

describe("profiles additions", () => {
  it("defaults: not an admin, both emails on, terms not yet accepted", async () => {
    const { rows } = await db.query(
      "select is_admin, email_daily, email_weekly, terms_accepted_at from public.profiles where id = $1",
      [ALICE],
    );
    expect(rows[0]).toEqual({
      is_admin: false,
      email_daily: true,
      email_weekly: true,
      terms_accepted_at: null,
    });
  });

  it("a user can set their email preferences and terms acceptance", async () => {
    await asAlice(() =>
      db.query(
        `update public.profiles
         set email_daily = false, email_weekly = false, terms_accepted_at = now()
         where id = $1`,
        [ALICE],
      ),
    );
    const { rows } = await db.query<{
      email_daily: boolean;
      email_weekly: boolean;
      terms_accepted_at: Date | null;
    }>("select email_daily, email_weekly, terms_accepted_at from public.profiles where id = $1", [
      ALICE,
    ]);
    expect(rows[0]?.email_daily).toBe(false);
    expect(rows[0]?.email_weekly).toBe(false);
    expect(rows[0]?.terms_accepted_at).not.toBeNull();
  });

  it("a user cannot make themselves an admin", async () => {
    await expect(
      asAlice(() => db.query("update public.profiles set is_admin = true where id = $1", [ALICE])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("authenticated may update exactly the preference and terms columns, nothing else", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'profiles'
         and grantee = 'authenticated' and privilege_type = 'UPDATE'
       order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "email_daily",
      "email_weekly",
      "marketing_opt_in",
      "marketing_opt_in_at",
      "terms_accepted_at",
    ]);
  });

  it.each([
    ["plan", "update public.profiles set plan = 'pro' where id = $1"],
    [
      "subscription_status",
      "update public.profiles set subscription_status = 'active' where id = $1",
    ],
    ["stripe_customer_id", "update public.profiles set stripe_customer_id = 'cus_x' where id = $1"],
    [
      "stripe_subscription_id",
      "update public.profiles set stripe_subscription_id = 'sub_x' where id = $1",
    ],
    ["trial_end", "update public.profiles set trial_end = now() where id = $1"],
    ["current_period_end", "update public.profiles set current_period_end = now() where id = $1"],
    [
      "cancel_at_period_end",
      "update public.profiles set cancel_at_period_end = true where id = $1",
    ],
    ["billing_event_at", "update public.profiles set billing_event_at = now() where id = $1"],
  ])("a user still cannot write the billing column %s", async (_col, sql) => {
    await expect(asAlice(() => db.query(sql, [ALICE]))).rejects.toThrow(/permission denied/i);
  });

  it("a user cannot change another user's preferences", async () => {
    const result = await asAlice(() =>
      db.query("update public.profiles set email_daily = false where id = $1", [BOB]),
    );
    expect(result.affectedRows).toBe(0);
    const { rows } = await db.query<{ email_daily: boolean }>(
      "select email_daily from public.profiles where id = $1",
      [BOB],
    );
    expect(rows[0]?.email_daily).toBe(true);
  });

  it("no API role can grant admin, not even the service role", async () => {
    await expect(
      asService(() => db.query("update public.profiles set is_admin = true where id = $1", [BOB])),
    ).rejects.toThrow(/founder only/i);
    const DAVE = "00000000-0000-4000-8000-0000000000d4";
    await db.query("insert into auth.users (id) values ($1)", [DAVE]);
    await db.query("delete from public.profiles where id = $1", [DAVE]);
    await expect(
      asService(() =>
        db.query("insert into public.profiles (id, is_admin) values ($1, true)", [DAVE]),
      ),
    ).rejects.toThrow(/founder only/i);
    await asService(() => db.query("insert into public.profiles (id) values ($1)", [DAVE]));
  });

  it("the founder (database owner, as in the SQL editor) can set is_admin", async () => {
    await db.query("update public.profiles set is_admin = true where id = $1", [BOB]);
    const { rows } = await db.query<{ is_admin: boolean }>(
      "select is_admin from public.profiles where id = $1",
      [BOB],
    );
    expect(rows[0]?.is_admin).toBe(true);
    // Other service-role writes to an admin's row still work.
    await asService(() =>
      db.query("update public.profiles set email_daily = false where id = $1", [BOB]),
    );
  });

  it("terms acceptance is stamped with the server time and stored once", async () => {
    const CAROL = "00000000-0000-4000-8000-0000000000e5";
    await db.query("insert into auth.users (id) values ($1)", [CAROL]);
    const asCarol = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", CAROL, fn);
    const read = async () =>
      (
        await db.query<{ t: Date | null }>(
          "select terms_accepted_at as t from public.profiles where id = $1",
          [CAROL],
        )
      ).rows[0]?.t ?? null;

    await asCarol(() =>
      db.query("update public.profiles set terms_accepted_at = '2001-01-01' where id = $1", [
        CAROL,
      ]),
    );
    const first = await read();
    expect(first).not.toBeNull();
    expect(first!.getUTCFullYear()).toBeGreaterThan(2001);

    await asCarol(() =>
      db.query("update public.profiles set terms_accepted_at = null where id = $1", [CAROL]),
    );
    await asCarol(() =>
      db.query(
        "update public.profiles set terms_accepted_at = now() + interval '1 day' where id = $1",
        [CAROL],
      ),
    );
    expect(await read()).toEqual(first);

    // The founder (postgres, as in the SQL editor) can still correct it.
    await db.query("update public.profiles set terms_accepted_at = null where id = $1", [CAROL]);
    expect(await read()).toBeNull();
  });
});

describe("events", () => {
  it("accepts known event names from the service role", async () => {
    await asService(() =>
      db.query("insert into public.events (user_id, name, props) values ($1, 'signed_up', '{}')", [
        ALICE,
      ]),
    );
    const { rows } = await db.query("select name from public.events");
    expect(rows).toEqual([{ name: "signed_up" }]);
  });

  it("refuses unknown event names", async () => {
    await expect(
      db.query("insert into public.events (name) values ('page_viewed_by_tracker')"),
    ).rejects.toThrow(/check/i);
  });

  it("refuses oversized props", async () => {
    const big = JSON.stringify({ blob: "x".repeat(2000) });
    await expect(
      db.query("insert into public.events (name, props) values ('signed_up', $1::jsonb)", [big]),
    ).rejects.toThrow(/check/i);
  });

  it("keeps the event when the user is deleted, without the user id", async () => {
    await db.query("insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000c3')");
    await db.query(
      "insert into public.events (user_id, name) values ('00000000-0000-4000-8000-0000000000c3', 'trial_started')",
    );
    await db.query("delete from auth.users where id = '00000000-0000-4000-8000-0000000000c3'");
    const { rows } = await db.query(
      "select user_id from public.events where name = 'trial_started'",
    );
    expect(rows).toEqual([{ user_id: null }]);
  });

  it("is invisible to anon and authenticated", async () => {
    await db.query("insert into public.events (user_id, name) values ($1, 'feed_opened')", [ALICE]);
    for (const as of [asAnon, asAlice]) {
      const rows = await as(async () => {
        try {
          return (await db.query("select * from public.events")).rows;
        } catch (error) {
          expect(String(error)).toMatch(/permission denied/i);
          return [];
        }
      });
      expect(rows).toEqual([]);
    }
  });

  it("cannot be written by anon or authenticated", async () => {
    for (const as of [asAnon, asAlice]) {
      await expect(
        as(() => db.query("insert into public.events (name) values ('signed_up')")),
      ).rejects.toThrow(/permission denied|row-level security/i);
    }
  });

  it("anon and authenticated hold no privilege on events", async () => {
    const { rows } = await db.query<{ role: string; priv: string }>(
      `select r.role, p.priv
       from (values ('anon'), ('authenticated')) as r(role)
       cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
       where has_table_privilege(r.role, 'public.events', p.priv)`,
    );
    expect(rows).toEqual([]);
  });
});

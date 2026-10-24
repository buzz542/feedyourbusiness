import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/**
 * Migration `profiles_app` (docs/PLAN.md 6.1): admin flag, email preferences, terms acceptance,
 * and the server-only `events` table for first-party analytics.
 */

const ALICE = "00000000-0000-4000-8000-0000000001a1";
const BOB = "00000000-0000-4000-8000-0000000001b2";

let db: PGlite;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] as T;
}

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

describe("profiles: new columns", () => {
  it("default to not admin, both emails on, terms not yet accepted", async () => {
    const row = await one(
      "select is_admin, email_daily, email_weekly, terms_accepted_at from public.profiles where id = $1",
      [ALICE],
    );
    expect(row).toEqual({
      is_admin: false,
      email_daily: true,
      email_weekly: true,
      terms_accepted_at: null,
    });
  });

  it("a user can turn their own emails off and on", async () => {
    await asAlice(() =>
      db.query(
        "update public.profiles set email_daily = false, email_weekly = false where id = $1",
        [ALICE],
      ),
    );
    expect(
      await one("select email_daily, email_weekly from public.profiles where id = $1", [ALICE]),
    ).toEqual({ email_daily: false, email_weekly: false });
    await asAlice(() =>
      db.query("update public.profiles set email_daily = true where id = $1", [ALICE]),
    );
  });

  it("a user cannot make themselves an admin", async () => {
    await expect(
      asAlice(() => db.query("update public.profiles set is_admin = true where id = $1", [ALICE])),
    ).rejects.toThrow(/permission denied/i);
  });

  it.each([
    ["plan", "plan = 'pro'"],
    ["subscription_status", "subscription_status = 'active'"],
    ["stripe_customer_id", "stripe_customer_id = 'cus_fake'"],
    ["stripe_subscription_id", "stripe_subscription_id = 'sub_fake'"],
    ["trial_end", "trial_end = now() + interval '1 year'"],
    ["current_period_end", "current_period_end = now() + interval '1 year'"],
    ["cancel_at_period_end", "cancel_at_period_end = true"],
    ["trial_reminder_sent_at", "trial_reminder_sent_at = now()"],
    ["billing_event_at", "billing_event_at = now()"],
  ])("a user still cannot write the billing column %s", async (_column, set) => {
    await expect(
      asAlice(() => db.query(`update public.profiles set ${set} where id = $1`, [ALICE])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a user cannot change another user's email preferences", async () => {
    const result = await asAlice(() =>
      db.query("update public.profiles set email_daily = false where id = $1", [BOB]),
    );
    expect(result.affectedRows).toBe(0);
    expect(
      (
        await one<{ email_daily: boolean }>(
          "select email_daily from public.profiles where id = $1",
          [BOB],
        )
      ).email_daily,
    ).toBe(true);
  });

  it("no API role can set the admin flag, the service role included", async () => {
    await expect(
      asService(() => db.query("update public.profiles set is_admin = true where id = $1", [BOB])),
    ).rejects.toThrow(/is_admin/);
    await expect(
      asService(() =>
        db.query("insert into public.profiles (id, is_admin) values (gen_random_uuid(), true)"),
      ),
    ).rejects.toThrow(/is_admin|foreign key/);
  });

  it("the founder sets the admin flag in SQL as postgres, and the service role can still edit the row", async () => {
    await db.query("update public.profiles set is_admin = true where id = $1", [BOB]);
    // A service-role update that leaves is_admin alone still works (the Stripe webhook does this).
    await asService(() =>
      db.query("update public.profiles set trial_reminder_sent_at = now() where id = $1", [BOB]),
    );
    await expect(
      asService(() => db.query("update public.profiles set is_admin = false where id = $1", [BOB])),
    ).rejects.toThrow(/is_admin/);
    expect(
      (
        await one<{ is_admin: boolean }>("select is_admin from public.profiles where id = $1", [
          BOB,
        ])
      ).is_admin,
    ).toBe(true);
  });
});

describe("profiles: terms acceptance is recorded once", () => {
  it("a user can accept the terms, and the database stamps its own time", async () => {
    await asAlice(() =>
      db.query(
        "update public.profiles set terms_accepted_at = '2001-01-01T00:00:00Z' where id = $1",
        [ALICE],
      ),
    );
    const row = await one<{ terms_accepted_at: string; seconds_ago: number }>(
      `select terms_accepted_at, extract(epoch from (now() - terms_accepted_at)) as seconds_ago
       from public.profiles where id = $1`,
      [ALICE],
    );
    // A user cannot backdate or postdate their acceptance.
    expect(Math.abs(Number(row.seconds_ago))).toBeLessThan(60);
  });

  const acceptedAt = async (id: string) =>
    (
      await one<{ terms_accepted_at: string | null }>(
        "select terms_accepted_at from public.profiles where id = $1",
        [id],
      )
    ).terms_accepted_at;

  it("accepting again, as a double submit does, keeps the first time and does not error", async () => {
    const before = await acceptedAt(ALICE);
    await asAlice(() =>
      db.query(
        "update public.profiles set terms_accepted_at = now() + interval '1 day' where id = $1",
        [ALICE],
      ),
    );
    await asAlice(() =>
      db.query("update public.profiles set terms_accepted_at = now() where id = $1", [ALICE]),
    );
    expect(await acceptedAt(ALICE)).toEqual(before);
  });

  it("an accepted time cannot be cleared by any API role", async () => {
    const before = await acceptedAt(ALICE);
    for (const run of [asAlice, asService]) {
      await expect(
        run(() =>
          db.query("update public.profiles set terms_accepted_at = null where id = $1", [ALICE]),
        ),
      ).rejects.toThrow(/terms_accepted_at/);
    }
    expect(await acceptedAt(ALICE)).toEqual(before);
  });

  it("the service role cannot backdate an acceptance either", async () => {
    const before = await acceptedAt(ALICE);
    await asService(() =>
      db.query(
        "update public.profiles set terms_accepted_at = '2001-01-01T00:00:00Z' where id = $1",
        [ALICE],
      ),
    );
    expect(await acceptedAt(ALICE)).toEqual(before);
  });

  it("an inserted profile row cannot carry a backdated acceptance", async () => {
    const carol = "00000000-0000-4000-8000-0000000001d4";
    await db.query("insert into auth.users (id, email) values ($1, 'carol@example.test')", [carol]);
    // Remove the row the signup trigger made, so the next statement is a real INSERT.
    await db.query("delete from public.profiles where id = $1", [carol]);
    await asService(() =>
      db.query(
        "insert into public.profiles (id, terms_accepted_at) values ($1, '2001-01-01T00:00:00Z')",
        [carol],
      ),
    );
    const row = await one<{ seconds_ago: number }>(
      "select extract(epoch from (now() - terms_accepted_at)) as seconds_ago from public.profiles where id = $1",
      [carol],
    );
    expect(Math.abs(Number(row.seconds_ago))).toBeLessThan(60);
  });

  it("a user cannot accept the terms on someone else's behalf", async () => {
    const result = await asAlice(() =>
      db.query("update public.profiles set terms_accepted_at = now() where id = $1", [BOB]),
    );
    expect(result.affectedRows).toBe(0);
    expect(await acceptedAt(BOB)).toBeNull();
  });

  it("API roles cannot execute the trigger function", async () => {
    const row = await one<{ anon: boolean; authed: boolean }>(
      `select has_function_privilege('anon', 'public.profiles_guard_columns()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.profiles_guard_columns()', 'execute') as authed`,
    );
    expect(row).toEqual({ anon: false, authed: false });
  });

  it("other updates to the row leave the accepted time alone", async () => {
    const before = await one<{ terms_accepted_at: string }>(
      "select terms_accepted_at from public.profiles where id = $1",
      [ALICE],
    );
    await asAlice(() =>
      db.query("update public.profiles set email_weekly = true where id = $1", [ALICE]),
    );
    const after = await one<{ terms_accepted_at: string }>(
      "select terms_accepted_at from public.profiles where id = $1",
      [ALICE],
    );
    expect(after.terms_accepted_at).toEqual(before.terms_accepted_at);
  });
});

describe("events: first-party analytics, server only", () => {
  it("has RLS on and an explicit deny-all policy", async () => {
    const row = await one<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.events'::regclass",
    );
    expect(row.relrowsecurity).toBe(true);
    const policy = await one<{ roles: string[]; qual: string; with_check: string; cmd: string }>(
      `select roles, qual, with_check, cmd from pg_policies
       where schemaname = 'public' and tablename = 'events' and policyname = 'events_deny_all'`,
    );
    expect(policy).toEqual({
      roles: ["anon", "authenticated"],
      qual: "false",
      with_check: "false",
      cmd: "ALL",
    });
  });

  it.each(["anon", "authenticated"] as const)(
    "%s holds no privilege on events, any of its columns, or its sequence",
    async (role) => {
      const row = await one<Record<string, boolean>>(
        `select has_table_privilege($1, 'public.events', 'select') as s,
                has_table_privilege($1, 'public.events', 'insert') as i,
                has_table_privilege($1, 'public.events', 'update') as u,
                has_table_privilege($1, 'public.events', 'delete') as d,
                has_any_column_privilege($1, 'public.events', 'select') as cs,
                has_any_column_privilege($1, 'public.events', 'insert') as ci,
                has_any_column_privilege($1, 'public.events', 'update') as cu,
                has_sequence_privilege($1, pg_get_serial_sequence('public.events', 'id'), 'usage') as q`,
        [role],
      );
      expect(Object.values(row).every((v) => v === false)).toBe(true);
    },
  );

  it("props must be a JSON object", async () => {
    await expect(
      db.query("insert into public.events (name, props) values ('signed_up', '[1,2]'::jsonb)"),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.query(`insert into public.events (name, props) values ('signed_up', '"text"'::jsonb)`),
    ).rejects.toThrow(/check constraint/i);
  });

  it("is invisible and unwritable for anon and authenticated", async () => {
    await asService(() =>
      db.query("insert into public.events (user_id, name) values ($1, 'signed_up')", [ALICE]),
    );
    await expect(asAnon(() => db.query("select * from public.events"))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asAlice(() => db.query("select * from public.events"))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asAlice(() =>
        db.query("insert into public.events (user_id, name) values ($1, 'post_saved')", [ALICE]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the service role records events", async () => {
    const row = await asService(() =>
      one<{ name: string; props: unknown }>(
        `insert into public.events (user_id, name, props) values ($1, 'feed_opened', '{"view":"today"}')
         returning name, props`,
        [ALICE],
      ),
    );
    expect(row).toEqual({ name: "feed_opened", props: { view: "today" } });
  });

  it("refuses an unknown event name", async () => {
    await expect(
      db.query("insert into public.events (name) values ('page_viewed')"),
    ).rejects.toThrow(/check constraint/i);
  });

  it("caps props at about 1 KB", async () => {
    await expect(
      db.query("insert into public.events (name, props) values ('signed_up', $1::jsonb)", [
        JSON.stringify({ pad: "x".repeat(2000) }),
      ]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("keeps events when the user is deleted, without the user id", async () => {
    const tmp = "00000000-0000-4000-8000-0000000001c3";
    await db.query("insert into auth.users (id, email) values ($1, 'tmp@example.test')", [tmp]);
    await db.query("insert into public.events (user_id, name) values ($1, 'signed_up')", [tmp]);
    await db.query("delete from auth.users where id = $1", [tmp]);
    const row = await one<{ n: number }>(
      "select count(*)::int as n from public.events where name = 'signed_up' and user_id is null",
    );
    expect(row.n).toBeGreaterThanOrEqual(1);
  });

  it("has an index for metrics by name and time", async () => {
    const row = await one<{ n: number }>(
      "select count(*)::int as n from pg_indexes where schemaname = 'public' and indexname = 'events_name_at_idx'",
    );
    expect(row.n).toBe(1);
  });
});

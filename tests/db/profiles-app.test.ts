import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/** M1 migration `profiles_app` (docs/PLAN.md 6.1): profile preferences, admin flag, events. */

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const asAnon = <T>(fn: () => Promise<T>) => withRole(db, "anon", null, fn);

async function profile(id: string) {
  const { rows } = await db.query<{
    is_admin: boolean;
    email_daily: boolean;
    email_weekly: boolean;
    terms_accepted_at: Date | null;
  }>(
    "select is_admin, email_daily, email_weekly, terms_accepted_at from public.profiles where id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no profile ${id}`);
  return row;
}

beforeAll(async () => {
  db = await createDb();
  await db.query(
    "insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'bob@example.test')",
    [ALICE, BOB],
  );
  await db.query("insert into public.events (user_id, name) values ($1, 'signed_up')", [ALICE]);
});

afterAll(async () => {
  await db.close();
});

describe("profiles additions", () => {
  it("new profiles default to both emails on, not admin, terms not accepted", async () => {
    expect(await profile(ALICE)).toEqual({
      is_admin: false,
      email_daily: true,
      email_weekly: true,
      terms_accepted_at: null,
    });
  });

  it("a user can set their email preferences and accept the terms", async () => {
    await asAlice(() =>
      db.query(
        "update public.profiles set email_daily = false, email_weekly = false, terms_accepted_at = now() where id = $1",
        [ALICE],
      ),
    );
    const row = await profile(ALICE);
    expect(row.email_daily).toBe(false);
    expect(row.email_weekly).toBe(false);
    expect(row.terms_accepted_at).toBeInstanceOf(Date);
  });

  it("a user cannot make themselves an admin", async () => {
    await expect(
      asAlice(() => db.query("update public.profiles set is_admin = true where id = $1", [ALICE])),
    ).rejects.toThrow(/permission denied/i);
    expect((await profile(ALICE)).is_admin).toBe(false);
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
  ])("a user cannot write the billing column %s", async (_column, set) => {
    await expect(
      asAlice(() => db.query(`update public.profiles set ${set} where id = $1`, [ALICE])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a user cannot change another user's preferences", async () => {
    const result = await asAlice(() =>
      db.query("update public.profiles set email_daily = false where id = $1", [BOB]),
    );
    expect(result.affectedRows).toBe(0);
    expect((await profile(BOB)).email_daily).toBe(true);
  });
});

describe("events", () => {
  it("has RLS on", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.events'::regclass",
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it.each([
    ["anon", asAnonQuery],
    ["authenticated", asAliceQuery],
  ])("is invisible and unwritable to %s", async (_role, run) => {
    await expect(run("select * from public.events")).rejects.toThrow(/permission denied/i);
    await expect(
      run("insert into public.events (user_id, name) values (null, 'signed_up')"),
    ).rejects.toThrow(/permission denied/i);
    await expect(run("delete from public.events")).rejects.toThrow(/permission denied/i);
  });

  it("refuses unknown event names", async () => {
    await expect(
      db.query("insert into public.events (name) values ('page_viewed')"),
    ).rejects.toThrow(/check constraint/i);
  });

  it("caps props at 1 KB", async () => {
    await expect(
      db.query("insert into public.events (name, props) values ('feed_opened', $1)", [
        JSON.stringify({ x: "y".repeat(2000) }),
      ]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("keeps the event, without the user, when the user is deleted", async () => {
    await db.query("insert into public.events (user_id, name) values ($1, 'feed_opened')", [BOB]);
    await db.query("delete from auth.users where id = $1", [BOB]);
    const { rows } = await db.query<{ user_id: string | null }>(
      "select user_id from public.events where name = 'feed_opened'",
    );
    expect(rows).toEqual([{ user_id: null }]);
  });
});

function asAnonQuery(sql: string) {
  return asAnon(() => db.query(sql));
}
function asAliceQuery(sql: string) {
  return asAlice(() => db.query(sql));
}

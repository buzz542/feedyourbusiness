import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

const USER = "00000000-0000-4000-8000-0000000000d4";
const T = (iso: string) => new Date(iso).toISOString();

let db: PGlite;

async function patch(
  userId: string,
  eventAt: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const { rows } = await db.query<{ applied: boolean }>(
    "select public.apply_billing_patch($1, $2, $3::jsonb) as applied",
    [userId, T(eventAt), JSON.stringify(body)],
  );
  return rows[0]!.applied;
}

async function profile() {
  const { rows } = await db.query<Record<string, unknown>>(
    "select * from public.profiles where id = $1",
    [USER],
  );
  return rows[0]!;
}

beforeAll(async () => {
  db = await createDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query("delete from auth.users where id = $1", [USER]);
  await db.query("delete from public.billing_events");
  await db.query("insert into auth.users (id, email) values ($1, 'dave@example.test')", [USER]);
});

describe("apply_billing_patch", () => {
  it("applies a first patch and records the event time", async () => {
    const applied = await patch(USER, "2026-10-13T10:00:00Z", {
      plan: "pro",
      subscription_status: "trialing",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      trial_end: "2026-10-20T10:00:00Z",
      cancel_at_period_end: false,
    });

    expect(applied).toBe(true);
    const row = await profile();
    expect(row.plan).toBe("pro");
    expect(row.subscription_status).toBe("trialing");
    expect(row.stripe_customer_id).toBe("cus_1");
    expect(new Date(row.trial_end as string).toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(new Date(row.billing_event_at as string).toISOString()).toBe("2026-10-13T10:00:00.000Z");
  });

  it("ignores a stale event that arrives after a newer one", async () => {
    await patch(USER, "2026-10-14T10:00:00Z", { plan: "pro", subscription_status: "active" });

    const applied = await patch(USER, "2026-10-13T10:00:00Z", {
      plan: "none",
      subscription_status: "canceled",
    });

    expect(applied).toBe(false);
    const row = await profile();
    expect(row.plan).toBe("pro");
    expect(row.subscription_status).toBe("active");
  });

  it("applies an event with the same timestamp, so a redelivery is harmless", async () => {
    await patch(USER, "2026-10-14T10:00:00Z", { subscription_status: "active" });
    expect(await patch(USER, "2026-10-14T10:00:00Z", { subscription_status: "active" })).toBe(true);
  });

  it("only touches keys that are present", async () => {
    await patch(USER, "2026-10-13T10:00:00Z", { stripe_customer_id: "cus_1", plan: "pro" });
    await patch(USER, "2026-10-13T11:00:00Z", { subscription_status: "active" });

    const row = await profile();
    expect(row.stripe_customer_id).toBe("cus_1");
    expect(row.plan).toBe("pro");
    expect(row.subscription_status).toBe("active");
  });

  it("clears a column when the patch sets it to null", async () => {
    await patch(USER, "2026-10-13T10:00:00Z", { trial_end: "2026-10-20T10:00:00Z" });
    await patch(USER, "2026-10-14T10:00:00Z", { trial_end: null });

    expect((await profile()).trial_end).toBeNull();
  });

  it("re-arms the trial reminder when the trial end moves, and only then", async () => {
    await patch(USER, "2026-10-13T10:00:00Z", { trial_end: "2026-10-20T10:00:00Z" });
    await db.query(
      "update public.profiles set trial_reminder_sent_at = '2026-10-18T10:00:00Z' where id = $1",
      [USER],
    );

    await patch(USER, "2026-10-14T10:00:00Z", {
      trial_end: "2026-10-20T10:00:00Z",
      subscription_status: "trialing",
    });
    expect((await profile()).trial_reminder_sent_at).not.toBeNull();

    await patch(USER, "2026-10-15T10:00:00Z", { trial_end: "2026-10-27T10:00:00Z" });
    expect((await profile()).trial_reminder_sent_at).toBeNull();
  });

  it("returns false for an unknown user", async () => {
    expect(
      await patch("00000000-0000-4000-8000-0000000000ff", "2026-10-13T10:00:00Z", { plan: "pro" }),
    ).toBe(false);
  });

  it("rejects values outside the allowed sets", async () => {
    await expect(patch(USER, "2026-10-13T10:00:00Z", { plan: "enterprise" })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      patch(USER, "2026-10-13T10:00:00Z", { subscription_status: "made_up" }),
    ).rejects.toThrow(/check constraint/i);
  });

  it("is callable by the service role only", async () => {
    await expect(
      withRole(db, "authenticated", USER, () =>
        db.query('select public.apply_billing_patch($1, now(), \'{"plan":"pro"}\'::jsonb)', [USER]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withRole(db, "anon", null, () =>
        db.query("select public.apply_billing_patch($1, now(), '{}'::jsonb)", [USER]),
      ),
    ).rejects.toThrow(/permission denied/i);

    const applied = await withRole(db, "service_role", null, async () => {
      const { rows } = await db.query<{ ok: boolean }>(
        'select public.apply_billing_patch($1, now(), \'{"plan":"pro"}\'::jsonb) as ok',
        [USER],
      );
      return rows[0]!.ok;
    });
    expect(applied).toBe(true);
  });
});

describe("claim_billing_event", () => {
  const claim = async (id: string) =>
    (
      await db.query<{ r: string }>(
        "select public.claim_billing_event($1, 'customer.subscription.updated') as r",
        [id],
      )
    ).rows[0]!.r;

  it("returns new, then retry while unfinished, then duplicate once processed", async () => {
    expect(await claim("evt_1")).toBe("new");
    expect(await claim("evt_1")).toBe("retry");

    await db.query(
      "update public.billing_events set processed_at = now() where stripe_event_id = 'evt_1'",
    );

    expect(await claim("evt_1")).toBe("duplicate");
  });

  it("tracks events independently", async () => {
    expect(await claim("evt_a")).toBe("new");
    expect(await claim("evt_b")).toBe("new");
  });

  it("is callable by the service role only", async () => {
    await expect(
      withRole(db, "authenticated", USER, () =>
        db.query("select public.claim_billing_event('evt_x', 't')"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

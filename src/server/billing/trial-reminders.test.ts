import { beforeEach, describe, expect, it } from "vitest";
import { FakeProfileStore, FakeStripe, TEST_CONFIG, subscriptionFixture } from "./fakes";
import { handleStripeEvent } from "./events";
import { subscriptionEvent } from "./fakes";
import { REMINDER_CRON_PERIOD_HOURS } from "./constants";
import {
  reminderWindowHours,
  runTrialReminders,
  selectDueReminders,
  type Mailer,
} from "./trial-reminders";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

class FakeMailer implements Mailer {
  sent: Array<{ to: string; subject: string; text: string; html: string; at: Date }> = [];
  failNext = 0;
  constructor(private clock: () => Date) {}
  async send(message: { to: string; subject: string; text: string; html: string }) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("smtp down");
    }
    this.sent.push({ ...message, at: this.clock() });
  }
}

describe("reminderWindowHours", () => {
  it("adds one cron period and an hour of scheduler slack to the 48 hours of notice", () => {
    expect(reminderWindowHours(24)).toBe(73);
    expect(reminderWindowHours(1)).toBe(50);
  });

  it("defaults to the cron period vercel.json deploys", () => {
    expect(reminderWindowHours()).toBe(reminderWindowHours(REMINDER_CRON_PERIOD_HOURS));
  });
});

describe("selectDueReminders", () => {
  const now = new Date("2026-10-18T10:00:00Z");
  const trialing = (hoursLeft: number, cancelAtPeriodEnd = false) => ({
    id: `u-${hoursLeft}`,
    trialEnd: new Date(now.getTime() + hoursLeft * HOUR),
    cancelAtPeriodEnd,
  });

  it("is due once the charge is within the window", () => {
    const due = selectDueReminders(
      [trialing(72), trialing(48.5), trialing(48), trialing(47), trialing(1)],
      now,
      48,
    );
    expect(due.map((p) => p.id)).toEqual(["u-48", "u-47", "u-1"]);
  });

  it("is never due after the trial has ended, or at the exact moment it ends", () => {
    expect(selectDueReminders([trialing(0), trialing(-1)], now)).toEqual([]);
  });

  it("skips someone who has already cancelled, because they will not be charged", () => {
    expect(selectDueReminders([trialing(24, true)], now)).toEqual([]);
  });
});

describe("trial reminder on the daily Hobby schedule", () => {
  const MINUTE = 60_000;
  const firstDay = Date.parse("2026-10-13T00:00:00Z");
  /** Minutes past 07:00 UTC for successive days. Hobby fires anywhere within the hour. */
  const JITTERS = [[0], [59], [0, 59], [59, 0], [17, 42, 3, 58, 30]];
  /** Trial starts spread across a whole day, every 20 minutes. */
  const STARTS = Array.from({ length: 72 }, (_, i) => firstDay + i * 20 * MINUTE);

  /** Times the reminder was sent for one trial, with the cron firing daily at 07:00 plus jitter. */
  async function simulateDaily(start: number, jitter: number[], windowHours: number) {
    const store = new FakeProfileStore();
    store.addUser("user-1");
    const stripe = new FakeStripe();
    let clock = new Date(start);
    const mailer = new FakeMailer(() => clock);
    const trialEnd = Math.floor((start + 7 * 24 * HOUR) / 1000);
    await handleStripeEvent(
      subscriptionEvent("created", subscriptionFixture({ trial_end: trialEnd }), iso(start)),
      { store, stripe },
    );

    for (let day = 0; day <= 9; day++) {
      const minutes = jitter[day % jitter.length] ?? 0;
      const at = firstDay + day * 24 * HOUR + 7 * HOUR + minutes * MINUTE;
      if (at < start) continue;
      clock = new Date(at);
      await runTrialReminders({
        store,
        stripe,
        config: TEST_CONFIG,
        mailer,
        getEmail: async () => "maker@example.test",
        now: clock,
        windowHours,
      });
    }
    return { sent: mailer.sent.map((m) => m.at.getTime()), chargeAt: trialEnd * 1000 };
  }

  it.each(JITTERS.map((pattern) => ({ pattern })))(
    "sends exactly one reminder, at least 48 hours before the charge (jitter $pattern)",
    async ({ pattern }) => {
      const window = reminderWindowHours(24);
      for (const start of STARTS) {
        const { sent, chargeAt } = await simulateDaily(start, pattern, window);
        expect(sent, `trial starting ${iso(start)}`).toHaveLength(1);
        const notice = (chargeAt - sent[0]!) / HOUR;
        expect(notice, `trial starting ${iso(start)}`).toBeGreaterThanOrEqual(48);
        expect(notice, `trial starting ${iso(start)}`).toBeLessThanOrEqual(window);
      }
    },
  );

  it("would give less than 48 hours of notice with a plain 48 hour window (why the window widens)", async () => {
    let shortest = Infinity;
    for (const start of STARTS) {
      const { sent, chargeAt } = await simulateDaily(start, [0, 59], 48);
      for (const at of sent) shortest = Math.min(shortest, (chargeAt - at) / HOUR);
    }
    expect(shortest).toBeLessThan(48);
  });
});

describe("trial reminder, time travel on the hourly Pro schedule", () => {
  const start = Date.parse("2026-10-13T10:25:00Z");
  const HOURLY_WINDOW = reminderWindowHours(1);
  let store: FakeProfileStore;
  let stripe: FakeStripe;
  let clock: Date;
  let mailer: FakeMailer;

  const tick = (now: Date) => {
    clock = now;
    return runTrialReminders({
      store,
      stripe,
      config: TEST_CONFIG,
      mailer,
      getEmail: async (id) => (id === "user-1" ? "maker@example.test" : null),
      now,
      windowHours: HOURLY_WINDOW,
    });
  };

  /** Run the hourly cron from the start of the trial until `hours` have passed. */
  const runHourly = async (hours: number, from = 0) => {
    for (let h = from; h <= hours; h++) await tick(new Date(start + h * HOUR));
  };

  beforeEach(async () => {
    store = new FakeProfileStore();
    store.addUser("user-1");
    stripe = new FakeStripe();
    mailer = new FakeMailer(() => clock);

    // Checkout completes and Stripe starts a 7 day trial.
    const trialEnd = Math.floor((start + 7 * 24 * HOUR) / 1000);
    await handleStripeEvent(
      subscriptionEvent("created", subscriptionFixture({ trial_end: trialEnd }), iso(start)),
      { store, stripe },
    );
  });

  it("sends exactly one reminder, 49 to 50 hours before the first charge", async () => {
    await runHourly(9 * 24);

    expect(mailer.sent).toHaveLength(1);
    const chargeAt = start + 7 * 24 * HOUR;
    const hoursBeforeCharge = (chargeAt - mailer.sent[0]!.at.getTime()) / HOUR;
    expect(hoursBeforeCharge).toBeGreaterThan(49);
    expect(hoursBeforeCharge).toBeLessThanOrEqual(50);
  });

  it("sends nothing while the charge is further away than the window", async () => {
    await runHourly(7 * 24 - HOURLY_WINDOW - 1);
    expect(mailer.sent).toEqual([]);
  });

  it("the email states the exact charge, the date, the renewal period and how to cancel", async () => {
    await runHourly(9 * 24);
    const { to, subject, text, html } = mailer.sent[0]!;

    expect(to).toBe("maker@example.test");
    expect(subject).toBe("Your AskedFor trial ends soon");
    expect(text).toContain("$29.00");
    expect(text).toContain("October 20, 2026");
    expect(text).toContain("every month until you cancel");
    expect(text).toContain("two clicks in Settings");
    expect(text).toContain("https://app.example.test/app/settings");
    expect(html).toContain('href="https://app.example.test/app/settings"');
  });

  it("does not remind someone who cancelled before the window", async () => {
    await runHourly(3 * 24);
    await handleStripeEvent(
      subscriptionEvent(
        "updated",
        subscriptionFixture({
          cancel_at_period_end: true,
          trial_end: Math.floor((start + 7 * 24 * HOUR) / 1000),
        }),
        iso(start + 3 * 24 * HOUR),
      ),
      { store, stripe },
    );
    await runHourly(9 * 24, 3 * 24 + 1);

    expect(mailer.sent).toEqual([]);
  });

  it("retries on the next hour when the email provider is down, and still sends only one", async () => {
    mailer.failNext = 2;
    await runHourly(9 * 24);

    expect(mailer.sent).toHaveLength(1);
    const chargeAt = start + 7 * 24 * HOUR;
    expect((chargeAt - mailer.sent[0]!.at.getTime()) / HOUR).toBeGreaterThan(45);
  });

  it("reports failures so the cron route can answer non-2xx", async () => {
    mailer.failNext = 1;
    const first = await tick(new Date(start + 5 * 24 * HOUR));
    expect(first).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0 });

    const second = await tick(new Date(start + 5 * 24 * HOUR + HOUR));
    expect(second).toEqual({ due: 1, sent: 1, failed: 0, skipped: 0 });
  });

  it("sends a fresh reminder if support extends the trial", async () => {
    await runHourly(5 * 24 + 2);
    expect(mailer.sent).toHaveLength(1);

    const newEnd = Math.floor((start + 14 * 24 * HOUR) / 1000);
    await handleStripeEvent(
      subscriptionEvent(
        "updated",
        subscriptionFixture({ trial_end: newEnd }),
        iso(start + 5 * 24 * HOUR + 3 * HOUR),
      ),
      { store, stripe },
    );
    await runHourly(16 * 24, 5 * 24 + 3);

    expect(mailer.sent).toHaveLength(2);
  });

  it("two overlapping runs cannot both send", async () => {
    const now = new Date(start + 5 * 24 * HOUR);
    const [a, b] = await Promise.all([tick(now), tick(now)]);

    expect(mailer.sent).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
  });

  it("does not send a reminder without the real price", async () => {
    stripe.price = { ...stripe.price, unitAmount: null };
    const result = await tick(new Date(start + 5 * 24 * HOUR));

    expect(result.failed).toBe(1);
    expect(mailer.sent).toEqual([]);
  });

  it("releases the claim when the user has no email address, so it can be retried", async () => {
    store.addUser("user-2", {
      subscription_status: "trialing",
      trial_end: iso(start + 6 * 24 * HOUR),
    });
    const result = await tick(new Date(start + 5 * 24 * HOUR));

    expect(result.failed).toBe(1);
    expect(store.row("user-2").trialReminderSentAt).toBeNull();
  });

  it("does nothing, and calls nobody, when nobody is due", async () => {
    const result = await tick(new Date(start + 24 * HOUR));
    expect(result).toEqual({ due: 0, sent: 0, failed: 0, skipped: 0 });
  });
});

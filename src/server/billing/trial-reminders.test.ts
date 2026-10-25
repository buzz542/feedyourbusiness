import { beforeEach, describe, expect, it } from "vitest";
import { FakeProfileStore, FakeStripe, TEST_CONFIG, subscriptionFixture } from "./fakes";
import { handleStripeEvent } from "./events";
import { subscriptionEvent } from "./fakes";
import {
  REMINDER_CRON_PERIOD_HOURS,
  REMINDER_HOURS_BEFORE_CHARGE,
  REMINDER_SCHEDULER_SLACK_HOURS,
  TRIAL_DAYS,
} from "./constants";
import {
  reminderWindowHours,
  runTrialReminders,
  selectDueReminders,
  type Mailer,
} from "./trial-reminders";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

class FakeMailer implements Mailer {
  sent: Array<{ to: string; subject: string; text: string; html: string; at: Date }> = [];
  failNext = 0;
  hang = false;
  constructor(private clock: () => Date) {}
  async send(message: { to: string; subject: string; text: string; html: string }) {
    if (this.hang) return new Promise<void>(() => {});
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("smtp down");
    }
    this.sent.push({ ...message, at: this.clock() });
  }
}

describe("reminderWindowHours", () => {
  it("covers two cron periods plus slack beyond the 48 hours, so one missed run still leaves 48", () => {
    expect(reminderWindowHours(24)).toBe(98);
    expect(reminderWindowHours(1)).toBe(52);
  });

  it("defaults to the cron period vercel.json deploys", () => {
    expect(reminderWindowHours()).toBe(reminderWindowHours(REMINDER_CRON_PERIOD_HOURS));
  });

  it("fits inside the trial, so the first run after sign-up is never already inside the window", () => {
    const period = REMINDER_CRON_PERIOD_HOURS + REMINDER_SCHEDULER_SLACK_HOURS;
    expect(TRIAL_DAYS * 24).toBeGreaterThanOrEqual(reminderWindowHours() + period);
    expect(TRIAL_DAYS * 24).toBeGreaterThanOrEqual(reminderWindowHours(24) + 25);
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

  it("skips someone who has already canceled, because they will not be charged", () => {
    expect(selectDueReminders([trialing(24, true)], now)).toEqual([]);
  });
});

/** One trial, start to finish, under a given cron cadence. Returns when the reminder went out. */
async function simulate(args: {
  start: number;
  ticks: (from: number, to: number) => number[];
  windowHours?: number;
  failFirstSends?: number;
}) {
  const store = new FakeProfileStore();
  store.addUser("user-1");
  const stripe = new FakeStripe();
  let clock = new Date(args.start);
  const mailer = new FakeMailer(() => clock);
  mailer.failNext = args.failFirstSends ?? 0;
  const chargeAt = Math.floor((args.start + TRIAL_DAYS * 24 * HOUR) / 1000) * 1000;
  await handleStripeEvent(
    subscriptionEvent(
      "created",
      subscriptionFixture({ trial_end: chargeAt / 1000 }),
      iso(args.start),
    ),
    { store, stripe },
  );
  for (const at of args.ticks(args.start, chargeAt + 2 * 24 * HOUR)) {
    clock = new Date(at);
    await runTrialReminders({
      store,
      stripe,
      config: TEST_CONFIG,
      mailer,
      getEmail: async () => "maker@example.test",
      now: clock,
      ...(args.windowHours === undefined ? {} : { windowHours: args.windowHours }),
    });
  }
  return { notices: mailer.sent.map((m) => (chargeAt - m.at.getTime()) / HOUR) };
}

const firstDay = Date.parse("2026-10-13T00:00:00Z");
/** Minutes past 07:00 UTC for successive days. Hobby fires anywhere within the hour. */
const JITTERS = [[0], [59], [0, 59], [59, 0], [17, 42, 3, 58, 30]];
/** Trial starts spread across a whole day, every 20 minutes. */
const STARTS = Array.from({ length: 72 }, (_, i) => firstDay + i * 20 * MINUTE);

const dailyTicks =
  (jitter: number[]) =>
  (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let day = 0; firstDay + day * 24 * HOUR <= to; day++) {
      const at =
        firstDay + day * 24 * HOUR + 7 * HOUR + (jitter[day % jitter.length] ?? 0) * MINUTE;
      if (at >= from && at <= to) out.push(at);
    }
    return out;
  };

/** Vercel Pro runs on the hour, which does not line up with the minute a trial started. */
const hourlyTicks = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let at = Math.ceil(from / HOUR) * HOUR; at <= to; at += HOUR) out.push(at);
  return out;
};

describe("trial reminder on the daily Hobby schedule", () => {
  const window = reminderWindowHours(24);

  it.each(JITTERS.map((pattern) => ({ pattern })))(
    "sends exactly one reminder, at least 48 hours ahead (jitter $pattern)",
    async ({ pattern }) => {
      for (const start of STARTS) {
        const { notices } = await simulate({
          start,
          ticks: dailyTicks(pattern),
          windowHours: window,
        });
        expect(notices, `trial starting ${iso(start)}`).toHaveLength(1);
        expect(notices[0], `trial starting ${iso(start)}`).toBeGreaterThanOrEqual(48);
        expect(notices[0], `trial starting ${iso(start)}`).toBeLessThanOrEqual(window);
      }
    },
  );

  it.each(JITTERS.map((pattern) => ({ pattern })))(
    "still gives 48 hours when the first due run fails (jitter $pattern)",
    async ({ pattern }) => {
      for (const start of STARTS) {
        const { notices } = await simulate({
          start,
          ticks: dailyTicks(pattern),
          windowHours: window,
          failFirstSends: 1,
        });
        expect(notices, `trial starting ${iso(start)}`).toHaveLength(1);
        expect(notices[0], `trial starting ${iso(start)}`).toBeGreaterThanOrEqual(48);
      }
    },
  );

  it("would give less than 48 hours with a plain 48 hour window (why the window is wider)", async () => {
    let shortest = Infinity;
    for (const start of STARTS) {
      const { notices } = await simulate({ start, ticks: dailyTicks([0, 59]), windowHours: 48 });
      for (const n of notices) shortest = Math.min(shortest, n);
    }
    expect(shortest).toBeLessThan(48);
  });
});

describe("trial reminder on the hourly Pro schedule", () => {
  const window = reminderWindowHours(1);

  it("sends exactly one reminder, at least 48 hours ahead, for trials starting at any minute", async () => {
    for (const start of STARTS) {
      const { notices } = await simulate({ start, ticks: hourlyTicks, windowHours: window });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toBeGreaterThanOrEqual(48);
      expect(notices[0]).toBeLessThanOrEqual(window);
    }
  });

  it("still gives 48 hours when the first due run fails", async () => {
    for (const start of STARTS) {
      const { notices } = await simulate({
        start,
        ticks: hourlyTicks,
        windowHours: window,
        failFirstSends: 1,
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toBeGreaterThanOrEqual(48);
    }
  });
});

describe("trial reminder on the schedule vercel.json deploys (default window)", () => {
  const ticks = REMINDER_CRON_PERIOD_HOURS === 24 ? dailyTicks([0, 59, 30]) : hourlyTicks;

  it("gives at least 48 hours, including when the first due run fails", async () => {
    for (const start of STARTS) {
      for (const failFirstSends of [0, 1]) {
        const { notices } = await simulate({ start, ticks, failFirstSends });
        expect(notices).toHaveLength(1);
        expect(notices[0]).toBeGreaterThanOrEqual(REMINDER_HOURS_BEFORE_CHARGE);
      }
    }
  });
});

describe("trial reminder, time travel on the hourly Pro schedule", () => {
  const start = Date.parse("2026-10-13T10:25:00Z");
  const chargeAt = start + 7 * 24 * HOUR;
  const HOURLY_WINDOW = reminderWindowHours(1);
  let store: FakeProfileStore;
  let stripe: FakeStripe;
  let clock: Date;
  let mailer: FakeMailer;

  const tick = (now: Date, extra: Partial<Parameters<typeof runTrialReminders>[0]> = {}) => {
    clock = now;
    return runTrialReminders({
      store,
      stripe,
      config: TEST_CONFIG,
      mailer,
      getEmail: async (id) => (id === "user-1" ? "maker@example.test" : null),
      now,
      windowHours: HOURLY_WINDOW,
      ...extra,
    });
  };

  /** Run the hourly cron, on the hour, from `fromHours` to `hours` after the trial started. */
  const runHourly = async (hours: number, fromHours = 0) => {
    for (const at of hourlyTicks(start + fromHours * HOUR, start + hours * HOUR)) {
      await tick(new Date(at));
    }
  };

  beforeEach(async () => {
    store = new FakeProfileStore();
    store.addUser("user-1");
    stripe = new FakeStripe();
    mailer = new FakeMailer(() => clock);

    // Checkout completes and Stripe starts a 7 day trial.
    await handleStripeEvent(
      subscriptionEvent(
        "created",
        subscriptionFixture({ trial_end: Math.floor(chargeAt / 1000) }),
        iso(start),
      ),
      { store, stripe },
    );
  });

  it("sends exactly one reminder, 51 to 52 hours before the first charge", async () => {
    await runHourly(9 * 24);

    expect(mailer.sent).toHaveLength(1);
    const hoursBeforeCharge = (chargeAt - mailer.sent[0]!.at.getTime()) / HOUR;
    expect(hoursBeforeCharge).toBeGreaterThan(51);
    expect(hoursBeforeCharge).toBeLessThanOrEqual(52);
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

  it("with a tax-exclusive price, states Stripe's invoice preview total (tax included)", async () => {
    stripe.price = { ...stripe.price, taxBehavior: "exclusive" };
    stripe.previews.set("sub_1", { total: 3480, currency: "usd" });
    await runHourly(9 * 24);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toContain("$34.80");
    expect(mailer.sent[0]!.text).not.toContain("$29.00");
  });

  it("with a tax-exclusive price and no preview, still sends in time, saying tax may be added", async () => {
    stripe.price = { ...stripe.price, taxBehavior: "exclusive" };
    await runHourly(9 * 24);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toContain("$29.00 plus any sales tax or VAT that applies");
    expect((chargeAt - mailer.sent[0]!.at.getTime()) / HOUR).toBeGreaterThanOrEqual(48);
  });

  it("a hung invoice preview never strands a claim", async () => {
    stripe.price = { ...stripe.price, taxBehavior: "exclusive" };
    stripe.previewNextInvoice = () => new Promise(() => {});
    const result = await tick(new Date(chargeAt - 60 * HOUR), {
      windowHours: 72,
      sendTimeoutMs: 5,
    });
    expect(result.failed).toBe(1);
    expect(store.row("user-1").trialReminderSentAt).toBeNull();
  });

  it("does not remind someone who canceled before the window", async () => {
    await runHourly(3 * 24);
    await handleStripeEvent(
      subscriptionEvent(
        "updated",
        subscriptionFixture({
          cancel_at_period_end: true,
          trial_end: Math.floor(chargeAt / 1000),
        }),
        iso(start + 3 * 24 * HOUR),
      ),
      { store, stripe },
    );
    await runHourly(9 * 24, 3 * 24 + 1);

    expect(mailer.sent).toEqual([]);
  });

  it("retries on the next run when the email provider is down, and still sends only one, 48 hours ahead", async () => {
    mailer.failNext = 2;
    await runHourly(9 * 24);

    expect(mailer.sent).toHaveLength(1);
    expect((chargeAt - mailer.sent[0]!.at.getTime()) / HOUR).toBeGreaterThanOrEqual(48);
  });

  it("reports failures so the cron route can answer non-2xx", async () => {
    mailer.failNext = 1;
    const first = await tick(new Date(start + 5 * 24 * HOUR));
    expect(first).toEqual({ due: 1, sent: 0, failed: 1, skipped: 0, deferred: 0 });

    const second = await tick(new Date(start + 5 * 24 * HOUR + HOUR));
    expect(second).toEqual({ due: 1, sent: 1, failed: 0, skipped: 0, deferred: 0 });
  });

  it("gives up on a send that hangs and releases the claim for the next run", async () => {
    mailer.hang = true;
    const result = await tick(new Date(start + 5 * 24 * HOUR), { sendTimeoutMs: 20 });

    expect(result.failed).toBe(1);
    expect(store.row("user-1").trialReminderSentAt).toBeNull();
  });

  it("stops claiming once the time budget is spent, leaving the rest for the next run", async () => {
    const result = await tick(new Date(start + 5 * 24 * HOUR), {
      budgetMs: 1000,
      elapsedMs: () => 5000,
    });

    expect(result).toEqual({ due: 1, sent: 0, failed: 0, skipped: 0, deferred: 1 });
    expect(store.row("user-1").trialReminderSentAt).toBeNull();
    expect(mailer.sent).toEqual([]);
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
    expect(result).toEqual({ due: 0, sent: 0, failed: 0, skipped: 0, deferred: 0 });
  });
});

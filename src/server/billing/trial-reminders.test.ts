import { beforeEach, describe, expect, it } from "vitest";
import { FakeProfileStore, FakeStripe, TEST_CONFIG, subscriptionFixture } from "./fakes";
import { handleStripeEvent } from "./events";
import { subscriptionEvent } from "./fakes";
import { runTrialReminders, selectDueReminders, type Mailer } from "./trial-reminders";

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

describe("selectDueReminders", () => {
  const now = new Date("2026-10-18T10:00:00Z");
  const trialing = (hoursLeft: number, cancelAtPeriodEnd = false) => ({
    id: `u-${hoursLeft}`,
    trialEnd: new Date(now.getTime() + hoursLeft * HOUR),
    cancelAtPeriodEnd,
  });

  it("is due once 48 hours or less remain", () => {
    const due = selectDueReminders(
      [trialing(72), trialing(48.5), trialing(48), trialing(47), trialing(1)],
      now,
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

describe("trial reminder, time travel", () => {
  const start = Date.parse("2026-10-13T10:25:00Z");
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

  it("sends exactly one reminder, 47 to 48 hours before the first charge", async () => {
    await runHourly(9 * 24);

    expect(mailer.sent).toHaveLength(1);
    const chargeAt = start + 7 * 24 * HOUR;
    const hoursBeforeCharge = (chargeAt - mailer.sent[0]!.at.getTime()) / HOUR;
    expect(hoursBeforeCharge).toBeGreaterThan(47);
    expect(hoursBeforeCharge).toBeLessThanOrEqual(48);
  });

  it("sends nothing during the first five days", async () => {
    await runHourly(5 * 24 - 1);
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
    expect(text).toContain("https://app.example.test/settings");
    expect(html).toContain('href="https://app.example.test/settings"');
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

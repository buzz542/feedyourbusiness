import { describe, expect, it } from "vitest";
import { renderTrialReminder } from "./trial-reminder";

const input = {
  chargeDate: new Date("2026-10-20T15:30:00Z"),
  price: { unitAmount: 2900, currency: "usd", interval: "month" as const },
  settingsUrl: "https://app.example.test/settings",
};

describe("renderTrialReminder", () => {
  const email = renderTrialReminder(input);

  it("gives the date in UK time, the amount and the renewal period", () => {
    // 15:30 UTC on 20 October 2026 is 16:30 in London (BST).
    expect(email.text).toContain("October 20, 2026 at 4:30 PM UK time");
    expect(email.text).toContain("$29.00");
    expect(email.text).toContain("every month until you cancel");
  });

  it("tells the reader how to avoid the charge", () => {
    expect(email.text).toContain("cancel before then");
    expect(email.text).toContain(input.settingsUrl);
  });

  it("has no em dash in any part", () => {
    for (const part of [email.subject, email.text, email.html])
      expect(part).not.toContain("\u2014");
  });

  it("escapes anything interpolated into the HTML", () => {
    const hostile = renderTrialReminder({
      ...input,
      settingsUrl: 'https://x.test/"><script>alert(1)</script>',
    });
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });

  it("is plain service email: no tracking pixel and no marketing content", () => {
    expect(email.html).not.toMatch(/<img/i);
    expect(email.text).toContain("service email");
  });
});

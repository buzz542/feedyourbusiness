import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONSENT_WORDING } from "@/server/billing/consent";
import { TEST_PRICE } from "@/server/billing/fakes";
import { BillingOffer } from "./billing-offer";
import { formatChargeTime } from "./charge-date";

/** /app/billing before checkout (docs/PLAN.md 10.1). */

const NOW = new Date("2026-11-02T12:00:00Z");
const start = async () => ({ error: "test" });

describe("BillingOffer", () => {
  it("shows the full price with tax, renewal, first charge, reminder, how to cancel and consent", () => {
    const html = renderToStaticMarkup(
      <BillingOffer price={TEST_PRICE} now={NOW} startCheckout={start} />,
    );
    expect(html).toContain("$29.00 a month<span");
    expect(html).toContain(", tax included where it applies");
    expect(html).toContain("November 9, 2026 at 12:00 PM UTC");
    expect(html).toContain("at least 48 hours before the first charge");
    expect(html).toContain("Cancel any time in Settings, in two clicks.");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(CONSENT_WORDING);
    expect(html).toContain("then every month until you cancel");
  });

  it("names the zone of the charge time, and the browser shows the visitor's own (a US evening)", () => {
    // 9pm in New York on November 2 is 02:00 UTC on November 3.
    const evening = new Date("2026-11-03T02:00:00Z");
    const html = renderToStaticMarkup(
      <BillingOffer price={TEST_PRICE} now={evening} startCheckout={start} />,
    );
    expect(html).toContain("November 10, 2026 at 2:00 AM UTC");
    expect(formatChargeTime("2026-11-10T02:00:00.000Z", "America/New_York")).toBe(
      "November 9, 2026 at 9:00 PM EST",
    );
  });

  it("offers no checkout for a price that is not tax-inclusive, or no price", () => {
    for (const price of [
      { ...TEST_PRICE, taxBehavior: "exclusive" as const },
      { ...TEST_PRICE, unitAmount: 2500 },
      null,
    ]) {
      const html = renderToStaticMarkup(
        <BillingOffer price={price} now={NOW} startCheckout={start} />,
      );
      expect(html).toContain("Billing is not set up yet");
      expect(html).not.toContain('type="checkbox"');
    }
  });
});

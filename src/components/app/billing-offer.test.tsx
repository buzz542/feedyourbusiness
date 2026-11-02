import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONSENT_WORDING } from "@/server/billing/consent";
import { TEST_PRICE } from "@/server/billing/fakes";
import { BillingOffer } from "./billing-offer";

/** /app/billing before checkout (docs/PLAN.md 10.1). */

const NOW = new Date("2026-11-02T12:00:00Z");
const start = async () => ({ error: "test" });

describe("BillingOffer", () => {
  it("shows the full price with tax, renewal, first charge, reminder, how to cancel and consent", () => {
    const html = renderToStaticMarkup(
      <BillingOffer price={TEST_PRICE} now={NOW} startCheckout={start} />,
    );
    expect(html).toContain("$29");
    expect(html).toContain("tax included where it applies");
    expect(html).toContain("November 9, 2026");
    expect(html).toContain("at least 48 hours before the first charge");
    expect(html).toContain("Cancel any time in Settings, in two clicks.");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(CONSENT_WORDING);
    expect(html).toMatch(/renew|month/i);
  });

  it("offers no checkout for a price that is not tax-inclusive, or no price", () => {
    for (const price of [{ ...TEST_PRICE, taxBehavior: "exclusive" as const }, null]) {
      const html = renderToStaticMarkup(
        <BillingOffer price={price} now={NOW} startCheckout={start} />,
      );
      expect(html).toContain("Billing is not set up yet");
      expect(html).not.toContain('type="checkbox"');
    }
  });
});

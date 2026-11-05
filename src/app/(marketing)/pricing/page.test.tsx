import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ADVERTISED_PRICE,
  REMINDER_HOURS_BEFORE_CHARGE,
  TRIAL_DAYS,
} from "@/server/billing/constants";
import { formatMoney } from "@/server/billing/terms";
import PricingPage from "./page";

/** Public pricing (docs/PLAN.md 2.4, 9.6, M8). The copy gate checks every number has a claims row. */

const html = renderToStaticMarkup(<PricingPage />)
  .replace(/<[^>]+>/g, "")
  .replace(/\s+/g, " ");
const claims = readFileSync(
  path.resolve(import.meta.dirname, "../../../../docs/claims.md"),
  "utf8",
);

describe("pricing page", () => {
  it("shows the full price with tax, the trial, the card, the reminder and two-click cancel", () => {
    expect(html).toContain("$29 a month, tax included where it applies.");
    expect(html).toContain("7-day free trial. A card is required");
    expect(html).toContain("at least 48 hours before the first charge");
    expect(html).toContain("Cancel online in Settings in two clicks.");
  });

  it("states the numbers the billing code uses", () => {
    const whole = formatMoney(ADVERTISED_PRICE.unitAmount, ADVERTISED_PRICE.currency).replace(
      /\.00$/,
      "",
    );
    expect(whole).toBe("$29");
    expect(html).toContain(`${whole} a ${ADVERTISED_PRICE.interval}`);
    expect(html).toContain(`${TRIAL_DAYS}-day free trial`);
    expect(html).toContain(`${REMINDER_HOURS_BEFORE_CHARGE} hours`);
  });

  it("has a claims row with the exact wording of every sentence that carries a number", () => {
    for (const sentence of [
      "$29 a month, tax included where it applies. Prices in US dollars.",
      "Start with a 7-day free trial. A card is required to start it.",
      "We email you at least 48 hours before the first charge.",
      "When the trial ends, your card is charged $29, then $29 every month until you cancel.",
    ])
      expect(claims).toContain(sentence);
  });
});

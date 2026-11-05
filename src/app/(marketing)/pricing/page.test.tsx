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
import { sources } from "@/sources/registry";
import PricingPage, { metadata } from "./page";

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

  it("has a claims row with the exact wording of every list item and paragraph", () => {
    const raw = renderToStaticMarkup(<PricingPage />);
    const blocks = [...raw.matchAll(/<(li|p)[^>]*>([\s\S]*?)<\/\1>/g)].map((m) =>
      m[2]!
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    const cells = claims
      .split("\n")
      .filter((l) => l.startsWith("| "))
      .map((l) => l.split("|")[2] ?? "");
    for (const block of blocks)
      expect(
        cells.some((c) => c.includes(block)),
        block,
      ).toBe(true);
    expect(cells.some((c) => c.includes(metadata.description as string))).toBe(true);
  });

  it("names exactly the link sources in the registry as searches", () => {
    const names = sources.filter((s) => s.mode === "link").map((s) => s.displayName);
    const sentence = /One-tap searches on (.+), opened in your browser\./.exec(html)?.[1] ?? "";
    expect(sentence.split(/, | and /).sort()).toEqual([...new Set(names)].sort());
  });
});

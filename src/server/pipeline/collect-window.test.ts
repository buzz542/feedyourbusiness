import { describe, expect, it } from "vitest";
import { collectWindowHours, DAILY_WINDOW_HOURS, FIRST_RUN_WINDOW_HOURS } from "./collect";

/** The first run reads a month; a daily run, two days (the founder, 24 Nov 2026). */
describe("collectWindowHours", () => {
  it("reads a month on a product's first run", () => {
    expect(collectWindowHours(true)).toBe(FIRST_RUN_WINDOW_HOURS);
    expect(FIRST_RUN_WINDOW_HOURS).toBe(30 * 24);
  });

  it("reads the last 48 hours on a daily run", () => {
    expect(collectWindowHours(false)).toBe(DAILY_WINDOW_HOURS);
    expect(DAILY_WINDOW_HOURS).toBe(48);
  });
});

import { describe, expect, it } from "vitest";
import { costUsd, PRICES } from "./prices";

describe("PRICES (docs/PLAN.md 8.1)", () => {
  it("prices exactly the two models the plan uses", () => {
    expect(Object.keys(PRICES).sort()).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });

  it("charges Haiku 5.5 $0.10 in and $0.50 out per million tokens", () => {
    const tokens = { input: 10_000, output: 10_000, cacheRead: 0, cacheWrite: 0 };
    expect(costUsd("claude-haiku-5-5", tokens)).toBeCloseTo(0.001 + 0.005, 10);
  });

  it("charges 5-minute cache writes at 1.25x of input, and cache reads at 0.05x on Sonnet 5.5", () => {
    const tokens = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
    expect(costUsd("claude-sonnet-5-5", tokens)).toBeCloseTo(0.1 + 2.5, 10);
  });

  it("charges cache reads at 0.1x of input on Haiku 5.5", () => {
    const tokens = { input: 0, output: 0, cacheRead: 50_000, cacheWrite: 40_000 };
    expect(costUsd("claude-haiku-5-5", tokens)).toBeCloseTo(
      (50_000 * 0.01 + 40_000 * 0.125) / 1e6,
      10,
    );
  });

  it("uses Haiku 5.5's long-prompt rates, five times higher, above 100,000 prompt tokens", () => {
    const at = (input: number) =>
      costUsd("claude-haiku-5-5", { input, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(at(100_000)).toBeCloseTo(0.01, 10);
    expect(at(120_000)).toBeCloseTo(0.06, 10);
    // Cached prompt tokens count toward the prompt length too.
    const cached = costUsd("claude-haiku-5-5", {
      input: 50_000,
      output: 1000,
      cacheRead: 60_000,
      cacheWrite: 0,
    });
    expect(cached).toBeCloseTo((50_000 * 0.5 + 1000 * 2.5 + 60_000 * 0.05) / 1e6, 6);
  });

  it("rounds to the micro-dollar the llm_usage column stores", () => {
    const tokens = { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(costUsd("claude-sonnet-5-5", tokens)).toBe(0.000014);
    expect(costUsd("claude-haiku-5-5", { ...tokens, input: 3 })).toBe(0);
  });
});

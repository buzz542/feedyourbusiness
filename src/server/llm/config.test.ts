import { describe, expect, it } from "vitest";
import { CLIENT_OPTIONS } from "./anthropic-adapter";
import { loadLlmConfig } from "./config";
import { LlmConfigError } from "./llm";

const KEY = "sk-ant-api03-test";

describe("loadLlmConfig (docs/PLAN.md 8.1, 14)", () => {
  it("defaults the caps to $3 per product per month and $25 a day overall", () => {
    expect(loadLlmConfig({ ANTHROPIC_API_KEY: KEY })).toEqual({
      apiKey: KEY,
      caps: { productMonthlyUsd: 3, globalDailyUsd: 25 },
    });
  });

  it("treats an empty value as unset and reads numbers from the env", () => {
    const config = loadLlmConfig({
      ANTHROPIC_API_KEY: KEY,
      LLM_MONTHLY_USD_CAP_PER_PRODUCT: "",
      LLM_DAILY_USD_CAP: "12.5",
    });
    expect(config.caps).toEqual({ productMonthlyUsd: 3, globalDailyUsd: 12.5 });
  });

  it.each([
    [{}, "ANTHROPIC_API_KEY"],
    [{ ANTHROPIC_API_KEY: KEY, LLM_DAILY_USD_CAP: "lots" }, "LLM_DAILY_USD_CAP"],
    [{ ANTHROPIC_API_KEY: KEY, LLM_DAILY_USD_CAP: "-1" }, "LLM_DAILY_USD_CAP"],
    [{ ANTHROPIC_API_KEY: KEY, LLM_MONTHLY_USD_CAP_PER_PRODUCT: "0" }, "LLM_MONTHLY"],
  ])("refuses %j, naming the field and never the key", (env, field) => {
    const error = (() => {
      try {
        loadLlmConfig(env);
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected an error");
    })();
    expect(error).toBeInstanceOf(LlmConfigError);
    expect(error.message).toContain(field);
    expect(error.message).not.toContain(KEY);
  });
});

describe("the Anthropic client", () => {
  it("times out at 60 seconds and lets the SDK retry 429 and 5xx twice", () => {
    expect(CLIENT_OPTIONS).toEqual({ timeout: 60_000, maxRetries: 2 });
  });
});

import { describe, expect, it, vi } from "vitest";
import { createLlmClient } from "./anthropic";
import { loadLlmConfig } from "./config";

/** The Anthropic adapter's mapping (no network) and the model settings. */

describe("createLlmClient", () => {
  const message = {
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: '{"a":' },
      { type: "text", text: "1}" },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: 7,
    },
  };

  it("sends one user message with the system blocks and JSON-schema output", async () => {
    const create = vi.fn(async () => message);
    const client = createLlmClient({ create } as never);
    const signal = new AbortController().signal;
    const response = await client.create({
      model: "claude-haiku-5-5",
      maxTokens: 100,
      system: [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }],
      input: "I",
      outputFormat: { type: "json_schema", schema: { type: "object" } },
      effort: "low",
      signal,
    });
    expect(create).toHaveBeenCalledWith(
      {
        model: "claude-haiku-5-5",
        max_tokens: 100,
        system: [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: "I" }],
        output_config: {
          format: { type: "json_schema", schema: { type: "object" } },
          effort: "low",
        },
      },
      { signal },
    );
    expect(response).toEqual({
      stopReason: "end_turn",
      text: '{"a":1}',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 7 },
    });
  });
});

describe("loadLlmConfig", () => {
  it("defaults the caps to $3 per product per month and $25 a day", () => {
    expect(loadLlmConfig({ ANTHROPIC_API_KEY: "k" })).toEqual({
      apiKey: "k",
      caps: { monthlyUsdPerProduct: 3, dailyUsdGlobal: 25 },
    });
  });

  it("reads caps from the environment", () => {
    const config = loadLlmConfig({
      ANTHROPIC_API_KEY: "k",
      LLM_MONTHLY_USD_CAP_PER_PRODUCT: "1.5",
      LLM_DAILY_USD_CAP: "10",
    });
    expect(config.caps).toEqual({ monthlyUsdPerProduct: 1.5, dailyUsdGlobal: 10 });
  });

  it.each([
    [{}],
    [{ ANTHROPIC_API_KEY: "k", LLM_DAILY_USD_CAP: "lots" }],
    [{ ANTHROPIC_API_KEY: "k", LLM_DAILY_USD_CAP: "-1" }],
    [{ ANTHROPIC_API_KEY: "k", LLM_MONTHLY_USD_CAP_PER_PRODUCT: "0" }],
  ])("refuses a missing key or a bad cap: %j", (env) => {
    expect(() => loadLlmConfig(env)).toThrow(/Model configuration/);
  });
});

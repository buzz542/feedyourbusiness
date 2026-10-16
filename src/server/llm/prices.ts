import type { LlmModel, TokenCounts } from "./ports";

/**
 * USD per million tokens (docs/PLAN.md 8.1 and 18), checked against Anthropic's model pricing on
 * 16 Oct 2026. Cache reads cost 0.1x the input rate and 5-minute cache writes 1.25x. Haiku 5.5 has
 * a second rate card for prompts over 100K tokens.
 */
interface RateCard {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface ModelPrices extends RateCard {
  /** Rates for prompts longer than `overTokens`, when the model has a second card. */
  long?: RateCard & { overTokens: number };
}

const card = (input: number, output: number): RateCard => ({
  input,
  output,
  cacheRead: input * 0.1,
  cacheWrite: input * 1.25,
});

export const PRICES: Readonly<Record<LlmModel, ModelPrices>> = {
  "claude-haiku-5-5": { ...card(0.1, 0.5), long: { ...card(0.5, 2.5), overTokens: 100_000 } },
  "claude-sonnet-5-5": card(2, 10),
};

export function costUsd(model: LlmModel, usage: TokenCounts): number {
  const prices = PRICES[model];
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const rates = prices.long && prompt > prices.long.overTokens ? prices.long : prices;
  return (
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadTokens * rates.cacheRead +
      usage.cacheWriteTokens * rates.cacheWrite) /
    1_000_000
  );
}

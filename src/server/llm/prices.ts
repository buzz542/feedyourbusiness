/**
 * Model prices in US dollars per million tokens (docs/PLAN.md 8.1). Recorded 6 Oct 2026 and
 * checked against Anthropic's pricing page on 28 Oct 2026: 5-minute cache writes cost 1.25x the
 * input rate; cache reads cost 0.1x on Haiku 5.5 and 0.05x on Sonnet 5.5. Haiku 5.5 has a second
 * rate card, five times higher on every line, for prompts over 100,000 tokens, where the prompt
 * counts cache reads and writes too. Update section 18 of the plan with any change here.
 */
export const PRICES = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.1,
    longPrompt: { overTokens: 100_000, factor: 5 },
  },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.05, longPrompt: null },
} as const;

export type LlmModel = keyof typeof PRICES;

const CACHE_WRITE_5M = 1.25;

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function isPricedModel(model: string): model is LlmModel {
  return Object.hasOwn(PRICES, model);
}

/** Cost of one call, rounded to the micro-dollar that llm_usage.cost_usd keeps. */
export function costUsd(model: LlmModel, tokens: TokenCounts): number {
  const price = PRICES[model];
  const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const factor =
    price.longPrompt && promptTokens > price.longPrompt.overTokens ? price.longPrompt.factor : 1;
  const input = price.input * factor;
  const microDollars =
    tokens.input * input +
    tokens.output * price.output * factor +
    tokens.cacheRead * input * price.cacheRead +
    tokens.cacheWrite * input * CACHE_WRITE_5M;
  return Math.round(microDollars) / 1e6;
}

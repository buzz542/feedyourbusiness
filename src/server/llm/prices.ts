/**
 * Model prices in US dollars per million tokens (docs/PLAN.md 8.1), recorded 6 Oct 2026 and
 * checked against Anthropic's pricing on 29 Oct 2026. Cache reads are 0.1x input and 5-minute cache
 * writes 1.25x. Haiku 5.5 doubles past 100,000 input tokens; no call here comes near that.
 */
export const PRICES = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
} as const;

export type LlmModel = keyof typeof PRICES;

import { z } from "zod";
import type { SpendCaps } from "./llm";

/**
 * Spend caps from the environment (docs/PLAN.md 8.1, 14). Missing values take the plan's defaults;
 * a value that is not a positive number is refused rather than read as "no cap".
 */

type Env = Readonly<Record<string, string | undefined>>;

const usd = (fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().positive().max(10_000));

const schema = z.object({
  LLM_MONTHLY_USD_CAP_PER_PRODUCT: usd(3),
  LLM_DAILY_USD_CAP: usd(25),
});

export function loadSpendCaps(env: Env = process.env): SpendCaps {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error("LLM spend caps must be positive numbers of dollars");
  return {
    productMonthlyUsd: parsed.data.LLM_MONTHLY_USD_CAP_PER_PRODUCT,
    dailyUsd: parsed.data.LLM_DAILY_USD_CAP,
  };
}

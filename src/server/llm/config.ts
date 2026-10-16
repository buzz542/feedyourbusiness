import { z } from "zod";
import type { LlmCaps } from "./llm";

/** Model settings from the environment (docs/PLAN.md 8.1, 14). */

const cap = (fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? Number(value) : fallback))
    .pipe(z.number().positive().max(10_000));

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  LLM_MONTHLY_USD_CAP_PER_PRODUCT: cap(3),
  LLM_DAILY_USD_CAP: cap(25),
});

type Env = Readonly<Record<string, string | undefined>>;

export function loadLlmConfig(env: Env = process.env): { apiKey: string; caps: LlmCaps } {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error("Model configuration is missing or invalid");
  return {
    apiKey: parsed.data.ANTHROPIC_API_KEY,
    caps: {
      monthlyUsdPerProduct: parsed.data.LLM_MONTHLY_USD_CAP_PER_PRODUCT,
      dailyUsdGlobal: parsed.data.LLM_DAILY_USD_CAP,
    },
  };
}

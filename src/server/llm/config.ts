import { z } from "zod";
import { LlmConfigError, type LlmCaps } from "./llm";

type Env = Readonly<Record<string, string | undefined>>;

/** A positive dollar amount, or the default when unset or empty. */
const usd = (fallback: number) =>
  z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().positive().finite().default(fallback),
  );

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  LLM_MONTHLY_USD_CAP_PER_PRODUCT: usd(3),
  LLM_DAILY_USD_CAP: usd(25),
});

export interface LlmConfig {
  apiKey: string;
  caps: LlmCaps;
}

/** Model config from the environment (docs/PLAN.md 14). Errors name fields, never values. */
export function loadLlmConfig(env: Env = process.env): LlmConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new LlmConfigError(`Invalid model configuration: ${fields}`);
  }
  return {
    apiKey: parsed.data.ANTHROPIC_API_KEY,
    caps: {
      productMonthlyUsd: parsed.data.LLM_MONTHLY_USD_CAP_PER_PRODUCT,
      globalDailyUsd: parsed.data.LLM_DAILY_USD_CAP,
    },
  };
}

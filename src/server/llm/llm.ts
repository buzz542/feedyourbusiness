import type { z } from "zod";
import type {
  Clock,
  LlmClient,
  LlmReply,
  LlmTask,
  SystemBlock,
  TokenUsage,
  UsageStore,
} from "./ports";
import { PRICES, type LlmModel } from "./prices";

/**
 * The model wrapper (docs/PLAN.md 8.1). Every model call in AskedFor goes through
 * `callStructured()`:
 *
 *   * a plain request with our own system text and input and a JSON schema output; no tools,
 *     server tools included (8.1);
 *   * the answer is validated with zod, retried once if it does not match, then rejected;
 *   * a refusal raises LlmRefusalError and is not retried;
 *   * every call, failed or not, writes one llm_usage row with its tokens and cost;
 *   * the per-product monthly cap and the global daily cap are checked before every call,
 *     the retry included.
 *
 * Nothing here logs prompts, inputs or answers.
 */

/** Every system prompt includes this sentence (8.2 guard test). */
export const NEVER_INFER =
  "Never infer, guess or mention anyone's health, politics, religion, sexuality, ethnicity, " +
  "nationality, immigration status, age, disability, pregnancy, union membership or criminal " +
  "record, and never describe a person. Describe products and companies only.";

export class LlmRefusalError extends Error {
  constructor() {
    super("The model declined the request");
    this.name = "LlmRefusalError";
  }
}

export class LlmSchemaError extends Error {
  constructor() {
    super("The model's answer did not match the schema");
    this.name = "LlmSchemaError";
  }
}

export type SpendCap = "product_monthly" | "global_daily";

export class LlmCapError extends Error {
  constructor(readonly cap: SpendCap) {
    super(`The ${cap.replace("_", " ")} model spend cap is reached`);
    this.name = "LlmCapError";
  }
}

export interface SpendCaps {
  /** LLM_MONTHLY_USD_CAP_PER_PRODUCT, default 3. */
  productMonthlyUsd: number;
  /** LLM_DAILY_USD_CAP, default 25. */
  dailyUsd: number;
}

export interface LlmDeps {
  client: LlmClient;
  usage: UsageStore;
  clock: Clock;
  caps: SpendCaps;
}

export interface StructuredCall<S extends z.ZodType> {
  task: LlmTask;
  /** Null only for calls that belong to no product (the anonymous preview). */
  productId: string | null;
  model: LlmModel;
  system: readonly SystemBlock[];
  input: string;
  schema: S;
  maxTokens: number;
}

/** Dollars for one call at the recorded prices, rounded to the column's 6 decimals. */
export function costUsd(model: LlmModel, usage: TokenUsage): number {
  const p = PRICES[model];
  const dollars =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

export const startOfUtcMonth = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
export const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function parse<S extends z.ZodType>(schema: S, reply: LlmReply): z.infer<S> | undefined {
  if (reply.stopReason !== "end_turn" && reply.stopReason !== "stop_sequence") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(reply.text);
  } catch {
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? (result.data as z.infer<S>) : undefined;
}

export function createLlm(deps: LlmDeps) {
  async function checkCaps(productId: string | null): Promise<void> {
    const now = deps.clock.now();
    if (productId !== null) {
      const month = await deps.usage.usageSince(productId, startOfUtcMonth(now));
      if (month.costUsd >= deps.caps.productMonthlyUsd) throw new LlmCapError("product_monthly");
    }
    const today = await deps.usage.usageSince(null, startOfUtcDay(now));
    if (today.costUsd >= deps.caps.dailyUsd) throw new LlmCapError("global_daily");
  }

  async function attempt<S extends z.ZodType>(call: StructuredCall<S>): Promise<LlmReply> {
    await checkCaps(call.productId);
    const reply = await deps.client.complete({
      model: call.model,
      system: call.system,
      input: call.input,
      schema: call.schema,
      maxTokens: call.maxTokens,
    });
    await deps.usage.record({
      productId: call.productId,
      task: call.task,
      model: call.model,
      ...reply.usage,
      costUsd: costUsd(call.model, reply.usage),
      at: deps.clock.now(),
    });
    if (reply.stopReason === "refusal") throw new LlmRefusalError();
    return reply;
  }

  return {
    async callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
      for (let tries = 0; tries < 2; tries++) {
        const parsed = parse(call.schema, await attempt(call));
        if (parsed !== undefined) return parsed;
      }
      throw new LlmSchemaError();
    },
  };
}

export type Llm = ReturnType<typeof createLlm>;

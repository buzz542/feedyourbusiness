import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { LlmClient, LlmTask, UsageStore } from "./ports";
import { costUsd, isPricedModel, type LlmModel } from "./prices";

/**
 * Every model call goes through here (docs/PLAN.md 8.1): JSON-schema output validated with zod,
 * one retry when the output does not validate, refusals raised as LlmRefusalError, a llm_usage
 * row with the cost for every call the API answers, and spend caps checked before every call.
 *
 * Errors carry codes only, never model output or input, so callers can log their class name.
 */

export class LlmRefusalError extends Error {
  override name = "LlmRefusalError";
  constructor() {
    super("The model declined the request");
  }
}

export class LlmOutputError extends Error {
  override name = "LlmOutputError";
  constructor(readonly reason: "invalid" | "truncated") {
    super(`Model output was ${reason}`);
  }
}

export class LlmCapError extends Error {
  override name = "LlmCapError";
  constructor(readonly cap: "product_monthly" | "global_daily") {
    super(`Model spend cap reached: ${cap}`);
  }
}

export class LlmConfigError extends Error {
  override name = "LlmConfigError";
}

export interface LlmCaps {
  /** LLM_MONTHLY_USD_CAP_PER_PRODUCT: per product, per calendar month (UTC). */
  productMonthlyUsd: number;
  /** LLM_DAILY_USD_CAP: every call, per UTC day. */
  globalDailyUsd: number;
}

export interface SystemBlock {
  text: string;
  /** Mark a stable block for prompt caching. Put cached blocks first. */
  cache?: boolean;
}

export interface StructuredCall<T> {
  task: LlmTask;
  productId: string | null;
  model: LlmModel;
  system: readonly SystemBlock[];
  input: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
}

export interface StructuredResult<T> {
  output: T;
  /** Total for the call, retry included. */
  costUsd: number;
}

const ATTEMPTS = 2;

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export interface Llm {
  callStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>>;
}

export function createLlm(deps: {
  client: LlmClient;
  usage: UsageStore;
  clock: () => Date;
  caps: LlmCaps;
}): Llm {
  const { client, usage, clock, caps } = deps;

  async function checkCaps(productId: string | null): Promise<void> {
    const now = clock();
    if (productId !== null) {
      const month = await usage.spentUsd(startOfUtcMonth(now), productId);
      if (month >= caps.productMonthlyUsd) throw new LlmCapError("product_monthly");
    }
    const day = await usage.spentUsd(startOfUtcDay(now), null);
    if (day >= caps.globalDailyUsd) throw new LlmCapError("global_daily");
  }

  async function record(call: StructuredCall<unknown>, message: Anthropic.Message) {
    const tokens = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    };
    const cost = costUsd(call.model, tokens);
    await usage.record({
      productId: call.productId,
      task: call.task,
      model: call.model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      costUsd: cost,
      at: clock(),
    });
    return cost;
  }

  return {
    async callStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
      if (!isPricedModel(call.model)) throw new LlmConfigError("Model has no price");
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: call.model,
        max_tokens: call.maxTokens,
        system: call.system.map((block) =>
          block.cache
            ? { type: "text", text: block.text, cache_control: { type: "ephemeral" } }
            : { type: "text", text: block.text },
        ),
        messages: [{ role: "user", content: call.input }],
        output_config: {
          // The SDK helper turns the zod schema into the JSON schema subset the API accepts.
          // We parse and validate ourselves, so a failure never echoes the output.
          format: { type: "json_schema", schema: zodOutputFormat(call.schema).schema },
          ...(call.effort ? { effort: call.effort } : {}),
        },
      };

      let total = 0;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        await checkCaps(call.productId);
        const message = await client.createMessage(params);
        total += await record(call, message);

        if (message.stop_reason === "refusal") throw new LlmRefusalError();
        if (message.stop_reason === "max_tokens") throw new LlmOutputError("truncated");
        const output = parse(message, call.schema);
        if (output.ok) return { output: output.value, costUsd: Math.round(total * 1e6) / 1e6 };
      }
      throw new LlmOutputError("invalid");
    },
  };
}

function parse<T>(
  message: Anthropic.Message,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false } {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type {
  LlmClient,
  LlmEffort,
  LlmModel,
  LlmRequest,
  LlmResponse,
  LlmTask,
  SystemTextBlock,
  UsageStore,
} from "./ports";
import { costUsd } from "./prices";

/**
 * The only way to call a model (docs/PLAN.md 8.1): JSON-schema output validated with zod, one retry
 * on invalid output, refusals raised, spend caps checked before every request, and one `llm_usage`
 * row for every request made.
 */

export class LlmRefusalError extends Error {
  constructor() {
    super("The model declined the request");
    this.name = "LlmRefusalError";
  }
}

export class LlmOutputError extends Error {
  constructor() {
    super("The model's output did not match the schema twice");
    this.name = "LlmOutputError";
  }
}

/** The reply stopped at max_tokens or the context window: retrying the same request would too. */
export class LlmTruncatedError extends LlmOutputError {
  constructor() {
    super();
    this.message = "The model's output was cut off";
    this.name = "LlmTruncatedError";
  }
}

export type SpendCap = "product_monthly" | "global_daily";

export class LlmCapError extends Error {
  constructor(readonly cap: SpendCap) {
    super(`Model spend cap reached: ${cap}`);
    this.name = "LlmCapError";
  }
}

export interface LlmCaps {
  /** `LLM_MONTHLY_USD_CAP_PER_PRODUCT`, per UTC calendar month. */
  monthlyUsdPerProduct: number;
  /** `LLM_DAILY_USD_CAP`, across every product and the preview, per UTC day. */
  dailyUsdGlobal: number;
}

export const DEFAULT_CAPS: LlmCaps = { monthlyUsdPerProduct: 3, dailyUsdGlobal: 25 };

export interface SystemBlock {
  text: string;
  /** Mark stable prefixes (instructions, definitions, the product profile) for prompt caching. */
  cache: boolean;
}

export interface StructuredCall<T> {
  task: LlmTask;
  /** Null only for calls that belong to no product (the instant preview). */
  productId: string | null;
  model: LlmModel;
  system: SystemBlock[];
  input: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort?: LlmEffort;
  signal?: AbortSignal;
}

export interface LlmDeps {
  client: LlmClient;
  usage: UsageStore;
  clock: () => Date;
  caps?: LlmCaps;
}

export interface Llm {
  callStructured<T>(call: StructuredCall<T>): Promise<T>;
}

const MAX_ATTEMPTS = 2;
/** The API accepts at most four cache_control breakpoints per request. */
const MAX_CACHED_BLOCKS = 4;
const TRUNCATED = new Set(["max_tokens", "model_context_window_exceeded"]);

const startOfUtcMonth = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * The JSON schema the API is asked to follow, from the SDK's own converter: every object closed,
 * and constraints structured outputs do not enforce (lengths, item counts) moved into descriptions.
 * Zod still enforces all of them on the reply.
 */
export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return zodOutputFormat(schema).schema;
}

function parse<T>(response: LlmResponse, schema: z.ZodType<T>): T | undefined {
  if (response.stopReason !== "end_turn") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(response.text);
  } catch {
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
}

export function createLlm({ client, usage, clock, caps = DEFAULT_CAPS }: LlmDeps): Llm {
  async function checkCaps(productId: string | null): Promise<void> {
    const now = clock();
    if (productId) {
      const spent = await usage.spendSince({ productId, since: startOfUtcMonth(now) });
      if (spent >= caps.monthlyUsdPerProduct) throw new LlmCapError("product_monthly");
    }
    const spent = await usage.spendSince({ productId: null, since: startOfUtcDay(now) });
    if (spent >= caps.dailyUsdGlobal) throw new LlmCapError("global_daily");
  }

  /**
   * One llm_usage row per request. A failed write is retried once; if it still fails, the paid
   * reply is not thrown away (the row is lost, which the global cap tolerates).
   */
  async function record(row: Parameters<UsageStore["record"]>[0]): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await usage.record(row);
        return;
      } catch (error) {
        if (attempt === 2)
          console.error(`[llm] usage row not written: ${(error as Error).name ?? "Error"}`);
      }
    }
  }

  return {
    async callStructured<T>(call: StructuredCall<T>): Promise<T> {
      // Only the preview belongs to no product; everything else counts against a product's cap.
      if (call.productId === null && call.task !== "preview")
        throw new Error(`An ${call.task} call needs a product`);
      if (call.system.filter((block) => block.cache).length > MAX_CACHED_BLOCKS)
        throw new Error(`At most ${MAX_CACHED_BLOCKS} system blocks can be cached`);

      const request: LlmRequest = {
        model: call.model,
        maxTokens: call.maxTokens,
        system: call.system.map((block): SystemTextBlock =>
          block.cache
            ? { type: "text", text: block.text, cache_control: { type: "ephemeral" } }
            : { type: "text", text: block.text },
        ),
        input: call.input,
        outputFormat: {
          type: "json_schema",
          schema: toOutputSchema(call.schema),
        },
        ...(call.effort ? { effort: call.effort } : {}),
        ...(call.signal ? { signal: call.signal } : {}),
      };

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await checkCaps(call.productId);
        const response = await client.create(request);
        await record({
          product_id: call.productId,
          task: call.task,
          model: call.model,
          input_tokens: response.usage.inputTokens,
          output_tokens: response.usage.outputTokens,
          cache_read_tokens: response.usage.cacheReadTokens,
          cache_write_tokens: response.usage.cacheWriteTokens,
          cost_usd: costUsd(call.model, response.usage),
        });
        if (response.stopReason === "refusal") throw new LlmRefusalError();
        if (TRUNCATED.has(response.stopReason ?? "")) throw new LlmTruncatedError();
        const parsed = parse(response, call.schema);
        if (parsed !== undefined) return parsed;
      }
      throw new LlmOutputError();
    },
  };
}

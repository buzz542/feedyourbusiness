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
 *   * a refusal raises LlmRefusalError and is not retried; any other failure (a timeout, a 5xx after
 *     the SDK's retries, a network error) raises LlmUnavailableError, which carries no message from
 *     the API;
 *   * every attempt reserves its place first (UsageStore.begin), under one lock, against the
 *     per-product monthly cap, the global daily cap and, when the call sets one, a per-task daily
 *     call limit, so parallel requests cannot all pass a limit; the retry reserves again;
 *   * every attempt, failed or not, writes one llm_usage row: the reported tokens and cost, or for a
 *     call that failed without an answer, an estimate of its input (it may still be billed);
 *   * a deadline, when given, covers both attempts: each gets what is left (at most 60 seconds, no
 *     SDK retries), and the retry is skipped when less than 10 seconds remain.
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

export class LlmUnavailableError extends Error {
  constructor() {
    super("The model did not answer");
    this.name = "LlmUnavailableError";
  }
}

export type SpendCap = "product_monthly" | "global_daily" | "task_daily";

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
  /**
   * Validates the answer when set; `schema` still shapes the JSON schema sent. The API treats
   * lengths, counts and patterns as hints, so a caller that enforces them itself can parse leniently
   * instead of losing a whole answer to one long item.
   */
  parseSchema?: z.ZodType<z.infer<S>>;
  maxTokens: number;
  /** Calls of this task for this product per UTC day, a retry included (8.3: 6 for drafts). */
  dailyCallLimit?: number;
  /** Milliseconds for the whole call, both attempts included (8.3: 45 seconds for a draft). */
  deadlineMs?: number;
}

/** Per request, the SDK's retries included (8.1). */
export const CALL_TIMEOUT_MS = 60_000;
/** The retry is skipped when less than this is left of a deadline. */
export const MIN_ATTEMPT_MS = 10_000;
/** A reservation outlives the longest call: 60 seconds, three times over, with room to spare. */
const LEASE_SECONDS = 600;
/** A cautious token count for text we send (about 3 characters a token). */
const tokensFor = (chars: number) => Math.ceil(chars / 3);

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
  async function attempt<S extends z.ZodType>(
    call: StructuredCall<S>,
    timeoutMs: number,
    maxRetries: number,
  ): Promise<LlmReply> {
    const inputTokens = tokensFor(
      call.input.length + call.system.reduce((n, b) => n + b.text.length, 0),
    );
    const begun = await deps.usage.begin({
      productId: call.productId,
      task: call.task,
      at: deps.clock.now(),
      taskDailyCalls: call.dailyCallLimit ?? null,
      productMonthlyUsd: deps.caps.productMonthlyUsd,
      dailyUsd: deps.caps.dailyUsd,
      reserveUsd: costUsd(call.model, {
        inputTokens,
        outputTokens: call.maxTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
      leaseSeconds: LEASE_SECONDS,
    });
    if (begun.kind === "refused") throw new LlmCapError(begun.limit);

    const record = (usage: TokenUsage) =>
      deps.usage.finish(begun.reservationId, {
        productId: call.productId,
        task: call.task,
        model: call.model,
        ...usage,
        costUsd: costUsd(call.model, usage),
        at: deps.clock.now(),
      });

    let reply: LlmReply;
    try {
      reply = await deps.client.complete({
        model: call.model,
        system: call.system,
        input: call.input,
        schema: call.schema,
        maxTokens: call.maxTokens,
        timeoutMs,
        maxRetries,
      });
    } catch {
      await record({ inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
      throw new LlmUnavailableError();
    }
    await record(reply.usage);
    if (reply.stopReason === "refusal") throw new LlmRefusalError();
    return reply;
  }

  return {
    async callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
      const started = deps.clock.now().getTime();
      for (let tries = 0; tries < 2; tries++) {
        let timeoutMs = CALL_TIMEOUT_MS;
        let maxRetries = 2;
        if (call.deadlineMs !== undefined) {
          const left = call.deadlineMs - (deps.clock.now().getTime() - started);
          if (left < MIN_ATTEMPT_MS) {
            if (tries === 0) throw new LlmUnavailableError();
            break;
          }
          timeoutMs = Math.min(CALL_TIMEOUT_MS, left);
          maxRetries = 0;
        }
        const parsed = parse(
          call.parseSchema ?? call.schema,
          await attempt(call, timeoutMs, maxRetries),
        );
        if (parsed !== undefined) return parsed;
      }
      throw new LlmSchemaError();
    },
  };
}

export type Llm = ReturnType<typeof createLlm>;

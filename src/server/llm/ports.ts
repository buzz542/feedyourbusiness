import type { z } from "zod";
import type { LlmModel } from "./prices";

/**
 * Ports for the model wrapper. The wrapper depends on these, not on the Anthropic SDK or
 * Supabase, so it is tested with in-memory fakes (./fakes.ts) and never calls the API in tests.
 */

export type LlmTask = "draft" | "classify" | "synthesize" | "preview";

export interface SystemBlock {
  text: string;
  /** Stable text marked for prompt caching (`cache_control: { type: "ephemeral" }`). */
  cache?: boolean;
}

/** One plain request: our own system text and input, a JSON schema output, and no tools. */
export interface LlmRequest {
  model: LlmModel;
  system: readonly SystemBlock[];
  input: string;
  schema: z.ZodType;
  maxTokens: number;
  /** For this request, the SDK's own retries included. */
  timeoutMs: number;
  /** The SDK's retries of 429 and 5xx: 2 normally, 0 when a deadline leaves no room. */
  maxRetries: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmReply {
  /** The API's stop_reason: "end_turn", "max_tokens", "refusal" and the rest. */
  stopReason: string;
  /** The JSON text of the answer. */
  text: string;
  usage: TokenUsage;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmReply>;
}

export interface UsageRow extends TokenUsage {
  productId: string | null;
  task: LlmTask;
  model: LlmModel;
  costUsd: number;
  at: Date;
}

export interface UsageSince {
  calls: number;
  costUsd: number;
}

export interface BeginCall {
  productId: string | null;
  task: LlmTask;
  at: Date;
  /** Calls of this task for this product per UTC day, or null for no such limit. */
  taskDailyCalls: number | null;
  productMonthlyUsd: number;
  dailyUsd: number;
  /** The most the call can cost, held against the caps until it ends. */
  reserveUsd: number;
  /** How long the reservation holds if the call never ends (a crash). */
  leaseSeconds: number;
}

export type BeginResult =
  | { kind: "ok"; reservationId: string }
  | { kind: "refused"; limit: "task_daily" | "product_monthly" | "global_daily" };

/**
 * llm_usage and its reservations (docs/PLAN.md 8.1). `begin` counts, checks and reserves under one
 * lock, so parallel calls cannot all pass a limit; `finish` writes the usage row and drops the
 * reservation together.
 */
export interface UsageStore {
  begin(call: BeginCall): Promise<BeginResult>;
  finish(reservationId: string, row: UsageRow): Promise<void>;
  /** Calls and dollars since `since`, for one product (or all when null), one task (or all). */
  usageSince(productId: string | null, since: Date, task?: LlmTask): Promise<UsageSince>;
}

export interface Clock {
  now(): Date;
}

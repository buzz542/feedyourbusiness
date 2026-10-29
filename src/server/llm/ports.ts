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

export interface UsageStore {
  record(row: UsageRow): Promise<void>;
  /** Calls and dollars since `since`, for one product (or all when null), one task (or all). */
  usageSince(productId: string | null, since: Date, task?: LlmTask): Promise<UsageSince>;
}

export interface Clock {
  now(): Date;
}

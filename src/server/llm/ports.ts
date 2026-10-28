import type Anthropic from "@anthropic-ai/sdk";

/**
 * Ports for the model wrapper (docs/PLAN.md 8.1). The wrapper depends on these, not on the SDK or
 * Supabase, so it is tested with the fakes in ./fakes.ts and never calls the API in tests.
 */

/** The tasks llm_usage accepts. Nothing else calls a model (D8: no model writes reply text). */
export type LlmTask = "draft" | "classify" | "synthesize" | "preview";

export interface LlmClient {
  createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<Anthropic.Message>;
}

/** One row of public.llm_usage. */
export interface UsageRow {
  productId: string | null;
  task: LlmTask;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  at: Date;
}

export interface UsageStore {
  record(row: UsageRow): Promise<void>;
  /** Spend in US dollars since `since`, for one product, or for every product when null. */
  spentUsd(since: Date, productId: string | null): Promise<number>;
}

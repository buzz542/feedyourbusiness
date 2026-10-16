/** Ports for the model wrapper (docs/PLAN.md 8.1). Adapters: anthropic.ts and supabase-usage.ts. */

export type LlmModel = "claude-haiku-5-5" | "claude-sonnet-5-5";
/** The values `llm_usage.task` allows. */
export type LlmTask = "draft" | "classify" | "synthesize" | "preview";
export type LlmEffort = "low" | "medium" | "high";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface SystemTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface LlmRequest {
  model: LlmModel;
  maxTokens: number;
  system: SystemTextBlock[];
  /** The single user message. */
  input: string;
  outputFormat: { type: "json_schema"; schema: Record<string, unknown> };
  effort?: LlmEffort;
  /** Ends the request (and the SDK's retries) early, for callers with an overall time budget. */
  signal?: AbortSignal;
}

export interface LlmResponse {
  stopReason: string | null;
  /** The text blocks of the reply, joined: the JSON the output format asked for. */
  text: string;
  usage: TokenCounts;
}

export interface LlmClient {
  create(request: LlmRequest): Promise<LlmResponse>;
}

/** One `llm_usage` row. */
export interface UsageRow {
  product_id: string | null;
  task: LlmTask;
  model: LlmModel;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
}

export interface UsageStore {
  record(row: UsageRow): Promise<void>;
  /** Total cost since `since`: one product's when `productId` is set, everyone's when it is null. */
  spendSince(query: { productId: string | null; since: Date }): Promise<number>;
}

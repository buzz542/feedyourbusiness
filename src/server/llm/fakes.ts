import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, UsageRow, UsageStore } from "./ports";

/** In-memory test doubles for the LLM ports. Test code only; nothing here reaches the network. */

export interface FakeReply {
  text?: string;
  stopReason?: Anthropic.StopReason;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function fakeMessage(reply: FakeReply, model = "claude-sonnet-5-5"): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model,
    container: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: reply.stopReason ?? "end_turn",
    stop_sequence: null,
    content:
      reply.text === undefined
        ? []
        : [
            { type: "thinking", thinking: "", signature: "sig" },
            { type: "text", text: reply.text, citations: null },
          ],
    usage: {
      input_tokens: reply.inputTokens ?? 1000,
      output_tokens: reply.outputTokens ?? 200,
      cache_read_input_tokens: reply.cacheReadTokens ?? 0,
      cache_creation_input_tokens: reply.cacheWriteTokens ?? 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  };
}

/** Answers each call with the next queued reply and keeps the requests it was sent. */
export class FakeLlmClient implements LlmClient {
  readonly requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  /** Runs on every call, before the reply: to abort, or to hang until aborted. */
  onCall?: (signal: AbortSignal | undefined) => void | Promise<void>;
  constructor(private readonly replies: FakeReply[] = []) {}

  queue(...replies: FakeReply[]): this {
    this.replies.push(...replies);
    return this;
  }

  async createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { signal?: AbortSignal } = {},
  ) {
    this.requests.push(params);
    this.signals.push(options.signal);
    await this.onCall?.(options.signal);
    const reply = this.replies.shift();
    if (!reply) throw new Error("FakeLlmClient: no reply queued");
    return fakeMessage(reply, params.model);
  }
}

export class FakeUsageStore implements UsageStore {
  readonly rows: UsageRow[] = [];

  async record(row: UsageRow) {
    this.rows.push(row);
  }

  async spentUsd(since: Date, productId: string | null) {
    return this.rows
      .filter((r) => r.at >= since && (productId === null || r.productId === productId))
      .reduce((sum, r) => sum + r.costUsd, 0);
  }
}

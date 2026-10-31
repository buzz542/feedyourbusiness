import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmClient, LlmReply, LlmRequest } from "./ports";

/**
 * The Anthropic adapter behind the LlmClient port. Thin on purpose: it maps our request to one
 * Messages call (cached system blocks, one user message, JSON schema output, no tools) and maps the
 * answer and usage back. Timeout 60 seconds; the SDK retries 429 and 5xx twice (8.1).
 */

/** The part of the SDK this adapter uses, so tests can pass a fake. */
export interface MessagesApi {
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: { timeout?: number; maxRetries?: number },
  ): Promise<Anthropic.Message>;
}

export function toMessageParams(request: LlmRequest): Anthropic.MessageCreateParamsNonStreaming {
  const format = zodOutputFormat(request.schema);
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system.map((block) => ({
      type: "text" as const,
      text: block.text,
      ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    })),
    messages: [{ role: "user", content: request.input }],
    output_config: { format: { type: "json_schema", schema: format.schema } },
  };
}

export function fromMessage(message: Anthropic.Message): LlmReply {
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return {
    stopReason: message.stop_reason ?? "",
    text,
    usage: {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

export function createAnthropicClient(messages: MessagesApi): LlmClient {
  return {
    async complete(request) {
      return fromMessage(
        await messages.create(toMessageParams(request), {
          timeout: request.timeoutMs,
          maxRetries: request.maxRetries,
        }),
      );
    },
  };
}

/**
 * The SDK, pinned against its environment variables: ANTHROPIC_BASE_URL could send site text and
 * excerpts to another host, ANTHROPIC_LOG=debug would log request bodies, and OpenTelemetry could
 * put prompt content in spans (docs/PLAN.md 2.3.10, 12.4). Only api.anthropic.com, no SDK logging,
 * no tracing. (ANTHROPIC_CUSTOM_HEADERS can still add request headers; it cannot move the host.)
 */
export function createAnthropicSdk(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: "https://api.anthropic.com",
    timeout: 60_000,
    maxRetries: 2,
    logLevel: "off",
    openTelemetry: {
      propagation: false,
      traces: { enabled: false, contentMode: "metadata_only" },
    },
  });
}

/** The wired client. Needs ANTHROPIC_API_KEY (F13); the session's tests never call it. */
export function createAnthropicClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmClient {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return createAnthropicClient(createAnthropicSdk(apiKey).messages);
}

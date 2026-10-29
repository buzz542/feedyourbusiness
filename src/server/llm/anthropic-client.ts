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
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
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
      return fromMessage(await messages.create(toMessageParams(request)));
    },
  };
}

/** The wired client. Needs ANTHROPIC_API_KEY (F13); the session's tests never build it. */
export function createAnthropicClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmClient {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const sdk = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  return createAnthropicClient(sdk.messages);
}

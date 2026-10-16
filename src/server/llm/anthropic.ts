import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmResponse } from "./ports";

/**
 * The Anthropic adapter for the LlmClient port: one Messages API request with JSON-schema output
 * (`output_config.format`). Timeout 60 seconds; the SDK retries 429 and 5xx twice (8.1).
 */

type MessagesApi = Pick<Anthropic["messages"], "create">;

export function createAnthropicClient(apiKey: string): LlmClient {
  return createLlmClient(new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 }).messages);
}

/** Maps the port onto the SDK. Separate from the constructor so tests can pass a fake. */
export function createLlmClient(messages: MessagesApi): LlmClient {
  return {
    async create(request): Promise<LlmResponse> {
      const message = await messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.input }],
          output_config: {
            format: request.outputFormat,
            ...(request.effort ? { effort: request.effort } : {}),
          },
        },
        request.signal ? { signal: request.signal } : undefined,
      );
      return {
        stopReason: message.stop_reason,
        text: message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join(""),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

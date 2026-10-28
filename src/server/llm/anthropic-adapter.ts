import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "./ports";

/** 60 second timeout; the SDK retries 429, 5xx and connection errors twice (docs/PLAN.md 8.1). */
export const CLIENT_OPTIONS = { timeout: 60_000, maxRetries: 2 } as const;

/** The only file that talks to the Anthropic SDK. Everything else uses the LlmClient port. */
export function createAnthropicClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey, ...CLIENT_OPTIONS });
  return {
    createMessage: (params) => client.messages.create(params),
  };
}

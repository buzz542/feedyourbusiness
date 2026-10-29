import { describe, expect, it } from "vitest";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createAnthropicClient,
  createAnthropicClientFromEnv,
  toMessageParams,
} from "./anthropic-client";

/** The Anthropic adapter (docs/PLAN.md 8.1), with a fake Messages API. Nothing calls the network. */

const Answer = z.object({ name: z.string().min(1).max(20), tags: z.array(z.string()).max(3) });

const request = {
  model: "claude-sonnet-5-5" as const,
  system: [{ text: "Stable.", cache: true }, { text: "Volatile." }],
  input: "Describe Acme.",
  schema: Answer,
  maxTokens: 2000,
};

describe("toMessageParams", () => {
  const params = toMessageParams(request);

  it("marks cached system blocks with cache_control and leaves the rest alone", () => {
    expect(params.system).toEqual([
      { type: "text", text: "Stable.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Volatile." },
    ]);
  });

  it("sends one user message, the model and max_tokens", () => {
    expect(params.messages).toEqual([{ role: "user", content: "Describe Acme." }]);
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.max_tokens).toBe(2000);
  });

  it("asks for JSON schema output built from the zod schema", () => {
    const format = params.output_config?.format;
    expect(format?.type).toBe("json_schema");
    expect(JSON.stringify(format?.schema)).toContain('"name"');
    expect(JSON.stringify(format?.schema)).toContain('"tags"');
  });

  it("sends no tools, no tool choice, no MCP servers and no container", () => {
    const keys = Object.keys(params).sort();
    expect(keys).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
  });
});

describe("createAnthropicClient", () => {
  it("returns the text, the stop reason and the usage, cache tokens included", async () => {
    const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client = createAnthropicClient({
      async create(params) {
        sent.push(params);
        return {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          stop_reason: "end_turn",
          stop_sequence: null,
          content: [
            { type: "thinking", thinking: "", signature: "x" },
            { type: "text", text: '{"name":"Acme",', citations: null },
            { type: "text", text: '"tags":[]}', citations: null },
          ],
          usage: {
            input_tokens: 1200,
            output_tokens: 300,
            cache_read_input_tokens: 5000,
            cache_creation_input_tokens: null,
          },
        } as unknown as Anthropic.Message;
      },
    });
    expect(await client.complete(request)).toEqual({
      stopReason: "end_turn",
      text: '{"name":"Acme","tags":[]}',
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 5000, cacheWriteTokens: 0 },
    });
    expect(sent).toHaveLength(1);
  });

  it("refuses to build without an API key", () => {
    expect(() => createAnthropicClientFromEnv({})).toThrow(/ANTHROPIC_API_KEY/);
  });
});

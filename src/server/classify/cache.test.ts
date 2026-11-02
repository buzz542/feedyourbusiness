import { readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createAnthropicClient, type MessagesApi } from "@/server/llm/anthropic-client";
import { createLlm } from "@/server/llm/llm";
import { FakeUsageStore } from "@/server/llm/fakes";
import { createClassifier } from "./classifier";
import { CLASSIFY_SYSTEM } from "./prompt";

/**
 * Prompt caching (docs/PLAN.md 8.2, M4 "Prompt caching"). The cached block must exceed the model's
 * minimum cacheable length: 512 tokens for Claude Haiku 5.5 per Anthropic's prompt caching
 * reference (checked 2 Nov 2026); we keep at least twice that, counting a token as 4 characters.
 * A pair of responses shows the second call reading the cache and the wrapper recording it.
 */

const HAIKU_MIN_CACHEABLE_TOKENS = 512;
const NOW = new Date("2026-11-02T12:00:00Z");

describe("prompt caching", () => {
  it("keeps the shared cached block well past the documented minimum", () => {
    expect(Math.floor(CLASSIFY_SYSTEM.length / 4)).toBeGreaterThanOrEqual(
      2 * HAIKU_MIN_CACHEABLE_TOKENS,
    );
  });

  it("sends the same cached prefix twice, and records the cache read on the second call", async () => {
    const pair = JSON.parse(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          "../../../tests/fixtures/anthropic/classify-cache-pair.json",
        ),
        "utf8",
      ),
    ) as { responses: Anthropic.Message[] };
    const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const messages: MessagesApi = {
      async create(params) {
        sent.push(params);
        const next = pair.responses[sent.length - 1];
        if (!next) throw new Error("no response left");
        return next;
      },
    };
    const usage = new FakeUsageStore();
    const llm = createLlm({
      client: createAnthropicClient(messages),
      usage,
      clock: { now: () => NOW },
      caps: { productMonthlyUsd: 3, dailyUsd: 25 },
    });
    const classifier = createClassifier({
      llm,
      profiles: {
        profile: async () => ({
          name: "Dunning Duck",
          oneLiner: null,
          description: null,
          audience: null,
          aliases: [],
          competitors: [],
        }),
      },
    });
    const post = (excerpt: string) => [
      { id: "0", source: "hackernews", community: "Hacker News", excerpt },
    ];
    await classifier.classify("product-1", post("Looking for an invoice reminder tool."));
    await classifier.classify("product-1", post("Any app that nudges late payers?"));

    expect(sent[0]!.system).toEqual(sent[1]!.system);
    const blocks = sent[0]!.system as Anthropic.TextBlockParam[];
    expect(blocks.map((b) => b.cache_control)).toEqual([
      { type: "ephemeral" },
      { type: "ephemeral" },
    ]);
    expect(sent[0]!.output_config).toMatchObject({ effort: "low" });
    expect(usage.rows.map((r) => [r.cacheWriteTokens, r.cacheReadTokens])).toEqual([
      [1560, 0],
      [0, 1560],
    ]);
    expect(usage.rows[1]!.cacheReadTokens).toBeGreaterThan(0);
    expect(usage.rows[1]!.costUsd).toBeLessThan(usage.rows[0]!.costUsd);
  });
});

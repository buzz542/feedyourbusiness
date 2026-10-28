import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLlmClient, FakeUsageStore } from "./fakes";
import {
  createLlm,
  LlmCapError,
  LlmOutputError,
  LlmRefusalError,
  type StructuredCall,
} from "./llm";

/** The model wrapper (docs/PLAN.md 8.1), with a fake client: nothing here calls the API. */

const NOW = new Date("2026-11-18T10:00:00Z");
const PRODUCT = "11111111-1111-4111-8111-111111111111";

const Answer = z.object({ name: z.string().min(1), terms: z.array(z.string()).min(2) });
const VALID = JSON.stringify({ name: "Invoice Pal", terms: ["a", "b"] });

function setup(caps = { productMonthlyUsd: 3, globalDailyUsd: 25 }) {
  const client = new FakeLlmClient();
  const usage = new FakeUsageStore();
  const llm = createLlm({ client, usage, clock: () => NOW, caps });
  return { client, usage, llm };
}

const call = (over: Partial<StructuredCall<z.infer<typeof Answer>>> = {}) => ({
  task: "draft" as const,
  productId: PRODUCT,
  model: "claude-sonnet-5-5" as const,
  system: [{ text: "Stable instructions.", cache: true }, { text: "Per-call notes." }],
  input: "Page text",
  schema: Answer,
  maxTokens: 4000,
  ...over,
});

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
}

describe("callStructured: the request", () => {
  it("sends the model, a JSON schema output format and the input as the user message", async () => {
    const { client, llm } = setup();
    client.queue({ text: VALID });
    await llm.callStructured(call({ effort: "low" }));
    const [request] = client.requests;
    expect(request).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: "Page text" }],
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    const schema = request!.output_config!.format!.schema as { properties: object };
    expect(Object.keys(schema.properties)).toEqual(["name", "terms"]);
  });

  it("marks only the cached system blocks with cache_control", async () => {
    const { client, llm } = setup();
    client.queue({ text: VALID });
    await llm.callStructured(call());
    expect(client.requests[0]!.system).toEqual([
      { type: "text", text: "Stable instructions.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Per-call notes." },
    ]);
  });

  it("refuses a model with no price, before calling it", async () => {
    const { client, llm } = setup();
    const error = await rejection(
      llm.callStructured({ ...call(), model: "claude-unpriced" as "claude-sonnet-5-5" }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(client.requests).toHaveLength(0);
  });
});

describe("callStructured: the answer", () => {
  it("returns the validated output, reading only the text blocks", async () => {
    const { client, llm } = setup();
    client.queue({ text: VALID });
    const result = await llm.callStructured(call());
    expect(result.output).toEqual({ name: "Invoice Pal", terms: ["a", "b"] });
  });

  it("retries schema-invalid output once, then succeeds", async () => {
    const { client, usage, llm } = setup();
    client.queue({ text: JSON.stringify({ name: "", terms: [] }) }, { text: VALID });
    const result = await llm.callStructured(call());
    expect(result.output.name).toBe("Invoice Pal");
    expect(client.requests).toHaveLength(2);
    expect(usage.rows).toHaveLength(2);
  });

  it("rejects after the retry is invalid too, including output that is not JSON", async () => {
    const { client, llm } = setup();
    client.queue({ text: "not json" }, { text: JSON.stringify({ name: "x" }) });
    const error = await rejection(llm.callStructured(call()));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as LlmOutputError).reason).toBe("invalid");
    expect(client.requests).toHaveLength(2);
  });

  it("never puts model output in the error it throws", async () => {
    const { client, llm } = setup();
    const secret = "SECRET-PAGE-TEXT";
    client.queue({ text: JSON.stringify({ name: secret }) }, { text: secret });
    const error = (await rejection(llm.callStructured(call()))) as Error;
    expect(`${error.message} ${error.stack} ${JSON.stringify(error)}`).not.toContain(secret);
  });

  it("raises LlmRefusalError on a refusal, without retrying", async () => {
    const { client, usage, llm } = setup();
    client.queue({ stopReason: "refusal" });
    const error = await rejection(llm.callStructured(call()));
    expect(error).toBeInstanceOf(LlmRefusalError);
    expect(client.requests).toHaveLength(1);
    expect(usage.rows).toHaveLength(1);
  });

  it("treats output cut off at max_tokens as truncated, without retrying", async () => {
    const { client, llm } = setup();
    client.queue({ text: '{"name": "Inv', stopReason: "max_tokens" });
    const error = await rejection(llm.callStructured(call()));
    expect(error).toBeInstanceOf(LlmOutputError);
    expect((error as LlmOutputError).reason).toBe("truncated");
    expect(client.requests).toHaveLength(1);
  });
});

describe("callStructured: usage and cost", () => {
  it("writes one llm_usage row per call with tokens and the computed cost", async () => {
    const { client, usage, llm } = setup();
    client.queue({
      text: VALID,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      cacheWriteTokens: 4000,
    });
    const result = await llm.callStructured(call());
    // Sonnet 5.5: $2 in, $10 out, cache reads $0.10 and 5-minute cache writes $2.50.
    const expected = (1000 * 2 + 500 * 10 + 2000 * 0.1 + 4000 * 2.5) / 1e6;
    expect(usage.rows).toEqual([
      {
        productId: PRODUCT,
        task: "draft",
        model: "claude-sonnet-5-5",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 2000,
        cacheWriteTokens: 4000,
        costUsd: expected,
        at: NOW,
      },
    ]);
    expect(result.costUsd).toBe(expected);
  });

  it("adds up the cost of a retried call", async () => {
    const { client, llm } = setup();
    client.queue(
      { text: "{}", inputTokens: 1000, outputTokens: 0 },
      { text: VALID, inputTokens: 1000, outputTokens: 0 },
    );
    expect((await llm.callStructured(call())).costUsd).toBe(0.004);
  });
});

describe("callStructured: spend caps", () => {
  it("stops a product at its monthly cap, counting from the first of the month (UTC)", async () => {
    const { client, usage, llm } = setup({ productMonthlyUsd: 3, globalDailyUsd: 100 });
    const row = { task: "classify" as const, model: "claude-haiku-5-5", inputTokens: 0 };
    const base = { ...row, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    usage.rows.push(
      { ...base, productId: PRODUCT, costUsd: 50, at: new Date("2026-10-31T23:59:59Z") },
      { ...base, productId: PRODUCT, costUsd: 2.5, at: new Date("2026-11-01T00:00:00Z") },
    );
    client.queue({ text: VALID });
    await llm.callStructured(call());

    usage.rows.push({ ...base, productId: PRODUCT, costUsd: 0.5, at: NOW });
    const error = await rejection(llm.callStructured(call()));
    expect(error).toBeInstanceOf(LlmCapError);
    expect((error as LlmCapError).cap).toBe("product_monthly");
    expect(client.requests).toHaveLength(1);
  });

  it("stops every call at the global daily cap, counting from midnight UTC", async () => {
    const { client, usage, llm } = setup({ productMonthlyUsd: 100, globalDailyUsd: 25 });
    const base = {
      task: "classify" as const,
      model: "claude-haiku-5-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    usage.rows.push(
      { ...base, productId: "other", costUsd: 30, at: new Date("2026-11-17T23:59:59Z") },
      { ...base, productId: "other", costUsd: 25, at: new Date("2026-11-18T00:00:00Z") },
    );
    for (const productId of [PRODUCT, null]) {
      const error = await rejection(llm.callStructured(call({ productId })));
      expect(error).toBeInstanceOf(LlmCapError);
      expect((error as LlmCapError).cap).toBe("global_daily");
    }
    expect(client.requests).toHaveLength(0);
  });

  it("checks the cap again before the retry", async () => {
    const { client, llm } = setup({ productMonthlyUsd: 0.001, globalDailyUsd: 25 });
    client.queue({ text: "{}", inputTokens: 1000, outputTokens: 0 }, { text: VALID });
    const error = await rejection(llm.callStructured(call()));
    expect(error).toBeInstanceOf(LlmCapError);
    expect(client.requests).toHaveLength(1);
  });
});

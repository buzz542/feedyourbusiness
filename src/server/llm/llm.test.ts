import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLlmClient, FakeUsageStore } from "./fakes";
import {
  costUsd,
  createLlm,
  LlmCapError,
  LlmRefusalError,
  LlmSchemaError,
  LlmUnavailableError,
  NEVER_INFER,
} from "./llm";
import { PRICES } from "./prices";

/** The model wrapper (docs/PLAN.md 8.1). No test here calls the API. */

const Answer = z.object({ name: z.string().min(1).max(20) });
const NOW = new Date("2026-10-29T12:00:00Z");

function setup(
  replies: ConstructorParameters<typeof FakeLlmClient>[0],
  usage = new FakeUsageStore(),
) {
  const client = new FakeLlmClient(replies);
  const llm = createLlm({
    client,
    usage,
    clock: { now: () => NOW },
    caps: { productMonthlyUsd: 3, dailyUsd: 25 },
  });
  const call = () =>
    llm.callStructured({
      task: "draft",
      productId: "product-1",
      model: "claude-sonnet-5-5",
      system: [{ text: "Stable instructions.", cache: true }, { text: "Per-call notes." }],
      input: "Describe Acme.",
      schema: Answer,
      maxTokens: 1000,
    });
  return { client, usage, call };
}

const ok = (text: string, usage = { input: 1000, output: 100 }) => ({
  stopReason: "end_turn",
  text,
  usage: {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
});

describe("callStructured", () => {
  it("returns the validated output and records one usage row with its cost", async () => {
    const { call, usage } = setup([ok('{"name":"Acme"}')]);
    expect(await call()).toEqual({ name: "Acme" });
    expect(usage.rows).toEqual([
      {
        productId: "product-1",
        task: "draft",
        model: "claude-sonnet-5-5",
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.003,
        at: NOW,
      },
    ]);
  });

  it("retries once when the output does not match the schema, then succeeds", async () => {
    const { call, client, usage } = setup([ok('{"name":""}'), ok('{"name":"Acme"}')]);
    expect(await call()).toEqual({ name: "Acme" });
    expect(client.requests).toHaveLength(2);
    expect(usage.rows).toHaveLength(2);
  });

  it("rejects after the one retry, recording both calls", async () => {
    const { call, usage } = setup([ok("not json"), ok('{"name":"' + "x".repeat(30) + '"}')]);
    await expect(call()).rejects.toBeInstanceOf(LlmSchemaError);
    expect(usage.rows).toHaveLength(2);
  });

  it("raises LlmRefusalError on a refusal, without a retry, and still records the call", async () => {
    const { call, client, usage } = setup([{ ...ok(""), stopReason: "refusal" }]);
    await expect(call()).rejects.toBeInstanceOf(LlmRefusalError);
    expect(client.requests).toHaveLength(1);
    expect(usage.rows).toHaveLength(1);
  });

  it("treats a cut-off answer as invalid output", async () => {
    const { call } = setup([
      { ...ok('{"name":"Ac'), stopReason: "max_tokens" },
      { ...ok('{"name":"Ac'), stopReason: "max_tokens" },
    ]);
    await expect(call()).rejects.toBeInstanceOf(LlmSchemaError);
  });

  it("marks cached system blocks for caching and sends the rest as is", async () => {
    const { call, client } = setup([ok('{"name":"Acme"}')]);
    await call();
    expect(client.requests[0]?.system).toEqual([
      { text: "Stable instructions.", cache: true },
      { text: "Per-call notes." },
    ]);
    expect(client.requests[0]?.model).toBe("claude-sonnet-5-5");
    expect(client.requests[0]?.maxTokens).toBe(1000);
  });

  it("never sends a server tool: the request has no tools at all", async () => {
    const { call, client } = setup([ok('{"name":"Acme"}')]);
    await call();
    expect(Object.keys(client.requests[0] ?? {}).sort()).toEqual([
      "input",
      "maxRetries",
      "maxTokens",
      "model",
      "schema",
      "system",
      "timeoutMs",
    ]);
  });
});

describe("spend caps", () => {
  it("stops a product that spent its monthly cap, without calling the model", async () => {
    const usage = new FakeUsageStore();
    usage.seed({ productId: "product-1", costUsd: 3, at: new Date("2026-10-02T00:00:00Z") });
    const { call, client } = setup([ok('{"name":"Acme"}')], usage);
    await expect(call()).rejects.toMatchObject({ name: "LlmCapError", cap: "product_monthly" });
    expect(client.requests).toHaveLength(0);
  });

  it("counts only this calendar month (UTC) for the product cap", async () => {
    const usage = new FakeUsageStore();
    usage.seed({ productId: "product-1", costUsd: 3, at: new Date("2026-09-30T23:59:59Z") });
    const { call } = setup([ok('{"name":"Acme"}')], usage);
    await expect(call()).resolves.toEqual({ name: "Acme" });
  });

  it("stops every call once the global daily cap is spent", async () => {
    const usage = new FakeUsageStore();
    usage.seed({ productId: "other", costUsd: 25, at: new Date("2026-10-29T00:00:01Z") });
    const { call, client } = setup([ok('{"name":"Acme"}')], usage);
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmCapError);
    expect((error as LlmCapError).cap).toBe("global_daily");
    expect(client.requests).toHaveLength(0);
  });

  it("counts only today (UTC) for the global cap", async () => {
    const usage = new FakeUsageStore();
    usage.seed({ productId: "other", costUsd: 25, at: new Date("2026-10-28T23:59:59Z") });
    const { call } = setup([ok('{"name":"Acme"}')], usage);
    await expect(call()).resolves.toEqual({ name: "Acme" });
  });

  it("a retry is refused once the first attempt crossed a cap", async () => {
    const usage = new FakeUsageStore();
    usage.seed({ productId: "product-1", costUsd: 2.999, at: new Date("2026-10-03T00:00:00Z") });
    const { call, client } = setup([ok("not json", { input: 1000, output: 1000 })], usage);
    await expect(call()).rejects.toBeInstanceOf(LlmCapError);
    expect(client.requests).toHaveLength(1);
  });
});

describe("costUsd", () => {
  it("prices input, output, cache reads and cache writes per million tokens", () => {
    expect(
      costUsd("claude-sonnet-5-5", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(2 + 10 + 0.2 + 2.5, 6);
    expect(
      costUsd("claude-haiku-5-5", {
        inputTokens: 2_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo(0.2, 6);
  });

  it("has a price for every model the wrapper accepts", () => {
    expect(Object.keys(PRICES).sort()).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });
});

describe("the never-infer rule", () => {
  it("is a fixed sentence every system prompt must include", () => {
    expect(NEVER_INFER).toMatch(/never infer/i);
    expect(NEVER_INFER).toMatch(/health/);
  });
});

describe("review fixes: failures, races and deadlines", () => {
  it("records a call that throws, and raises LlmUnavailableError with no API message", async () => {
    const { call, usage } = setup([new Error("529 overloaded: {body with details}")]);
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as Error).message).not.toMatch(/overloaded|body/);
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0]!.outputTokens).toBe(0);
    expect(usage.rows[0]!.inputTokens).toBeGreaterThan(0);
    expect(usage.reservations.size).toBe(0);
  });

  it("refuses the call past a daily call limit before it is made, the retry included", async () => {
    const usage = new FakeUsageStore();
    for (let i = 0; i < 5; i++)
      usage.seed({ productId: "product-1", costUsd: 0.01, at: NOW, task: "draft" });
    const client = new FakeLlmClient([ok('{"bad":1}'), ok('{"name":"Acme"}')]);
    const llm = createLlm({
      client,
      usage,
      clock: { now: () => NOW },
      caps: { productMonthlyUsd: 3, dailyUsd: 25 },
    });
    const call = () =>
      llm.callStructured({
        task: "draft",
        productId: "product-1",
        model: "claude-sonnet-5-5",
        system: [{ text: "S" }],
        input: "I",
        schema: Answer,
        maxTokens: 1000,
        dailyCallLimit: 6,
      });
    // The sixth call is made; its retry would be the seventh and is refused before it is sent.
    await expect(call()).rejects.toMatchObject({ name: "LlmCapError", cap: "task_daily" });
    expect(client.requests).toHaveLength(1);
  });

  it("lets only one of two parallel calls through when one place is left", async () => {
    const usage = new FakeUsageStore();
    // $2.995 spent: the first call reserves about a cent (1,000 output tokens), which fills the cap.
    usage.seed({ productId: "product-1", costUsd: 2.995, at: NOW });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      await gate;
      return ok('{"name":"Acme"}', { input: 100, output: 10 });
    };
    const client = new FakeLlmClient([slow, slow]);
    const llm = createLlm({
      client,
      usage,
      clock: { now: () => NOW },
      caps: { productMonthlyUsd: 3, dailyUsd: 25 },
    });
    const call = () =>
      llm.callStructured({
        task: "draft",
        productId: "product-1",
        model: "claude-sonnet-5-5",
        system: [{ text: "S" }],
        input: "I",
        schema: Answer,
        maxTokens: 1000,
      });
    const both = Promise.allSettled([call(), call()]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    const results = await both;
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(client.requests).toHaveLength(1);
  });

  it("gives each attempt what is left of the deadline, with no SDK retries, and skips a retry that cannot fit", async () => {
    let now = NOW.getTime();
    const usage = new FakeUsageStore();
    const client = new FakeLlmClient([
      (request) => {
        now += 40_000;
        expect(request).toMatchObject({ timeoutMs: 45_000, maxRetries: 0 });
        return ok('{"bad":1}');
      },
    ]);
    const llm = createLlm({
      client,
      usage,
      clock: { now: () => new Date(now) },
      caps: { productMonthlyUsd: 3, dailyUsd: 25 },
    });
    await expect(
      llm.callStructured({
        task: "draft",
        productId: "product-1",
        model: "claude-sonnet-5-5",
        system: [{ text: "S" }],
        input: "I",
        schema: Answer,
        maxTokens: 1000,
        deadlineMs: 45_000,
      }),
    ).rejects.toBeInstanceOf(LlmSchemaError);
    expect(client.requests).toHaveLength(1);
    expect(now - NOW.getTime()).toBeLessThanOrEqual(45_000);
  });

  it("validates with a lenient parse schema when one is given", async () => {
    const usage = new FakeUsageStore();
    const client = new FakeLlmClient([ok('{"name":"a name far longer than twenty characters"}')]);
    const llm = createLlm({
      client,
      usage,
      clock: { now: () => NOW },
      caps: { productMonthlyUsd: 3, dailyUsd: 25 },
    });
    const out = await llm.callStructured({
      task: "draft",
      productId: "product-1",
      model: "claude-sonnet-5-5",
      system: [{ text: "S" }],
      input: "I",
      schema: Answer,
      parseSchema: z.object({ name: z.string() }),
      maxTokens: 1000,
    });
    expect(out.name).toMatch(/far longer/);
  });
});

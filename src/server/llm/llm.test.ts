import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createLlm,
  LlmCapError,
  LlmOutputError,
  LlmRefusalError,
  LlmTruncatedError,
  type LlmCaps,
} from "./llm";
import type { LlmClient, LlmRequest, LlmResponse, UsageRow, UsageStore } from "./ports";
import { costUsd, PRICES } from "./prices";

/** The model wrapper (docs/PLAN.md 8.1), with a fake client, usage store and clock. */

const NOW = new Date("2026-10-16T12:00:00Z");
const Schema = z.object({ name: z.string().min(1), terms: z.array(z.string()).max(3) });

function reply(text: string, over: Partial<LlmResponse> = {}): LlmResponse {
  return {
    stopReason: "end_turn",
    text,
    usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ...over,
  };
}

function setup(replies: LlmResponse[], spend: { product?: number; global?: number } = {}) {
  const rows: UsageRow[] = [];
  const queue = [...replies];
  const client: LlmClient & { create: ReturnType<typeof vi.fn> } = {
    create: vi.fn(async (_req: LlmRequest) => {
      const next = queue.shift();
      if (!next) throw new Error("no scripted reply");
      return next;
    }),
  };
  const usage: UsageStore = {
    record: vi.fn(async (row: UsageRow) => void rows.push(row)),
    spendSince: vi.fn(async ({ productId }) =>
      productId ? (spend.product ?? 0) : (spend.global ?? 0),
    ),
  };
  const caps: LlmCaps = { monthlyUsdPerProduct: 3, dailyUsdGlobal: 25 };
  const llm = createLlm({ client, usage, clock: () => NOW, caps });
  return { llm, client, usage, rows };
}

const call = {
  task: "draft" as const,
  productId: "p1",
  model: "claude-sonnet-5-5" as const,
  system: [
    { text: "You draft product profiles.", cache: true },
    { text: "Today's product:", cache: false },
  ],
  input: "Title: Invoicer",
  schema: Schema,
  maxTokens: 4000,
};

describe("callStructured", () => {
  it("returns the parsed, validated output", async () => {
    const { llm } = setup([reply('{"name":"Invoicer","terms":["late invoices"]}')]);
    expect(await llm.callStructured(call)).toEqual({ name: "Invoicer", terms: ["late invoices"] });
  });

  it("asks for JSON-schema output and marks only the cached system blocks", async () => {
    const { llm, client } = setup([reply('{"name":"Invoicer","terms":[]}')]);
    await llm.callStructured(call);
    const req = client.create.mock.calls[0]![0] as LlmRequest;
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.maxTokens).toBe(4000);
    expect(req.system).toEqual([
      { type: "text", text: "You draft product profiles.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Today's product:" },
    ]);
    expect(req.outputFormat.type).toBe("json_schema");
    expect(req.outputFormat.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["name", "terms"],
    });
    // Constraints the API does not enforce move into descriptions; zod checks them on the reply.
    expect(JSON.stringify(req.outputFormat)).not.toMatch(/"maxItems"|"minLength"/);
    expect(req.input).toBe("Title: Invoicer");
  });

  it("writes one llm_usage row per API call, with the computed cost", async () => {
    const { llm, rows } = setup([
      reply('{"name":"Invoicer","terms":[]}', {
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 4000,
          cacheWriteTokens: 2000,
        },
      }),
    ]);
    await llm.callStructured(call);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      product_id: "p1",
      task: "draft",
      model: "claude-sonnet-5-5",
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 4000,
      cache_write_tokens: 2000,
    });
    // Sonnet 5.5: $2 in, $10 out, $0.20 cache read, $2.50 cache write (1.25x), per million tokens.
    expect(rows[0]!.cost_usd).toBeCloseTo(0.002 + 0.005 + 0.0008 + 0.005, 9);
  });

  it("retries schema-invalid output once, then succeeds", async () => {
    const { llm, client, rows } = setup([
      reply('{"name":""}'),
      reply('{"name":"Invoicer","terms":["a"]}'),
    ]);
    expect(await llm.callStructured(call)).toEqual({ name: "Invoicer", terms: ["a"] });
    expect(client.create).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  it("rejects after a second invalid output", async () => {
    const { llm, client, rows } = setup([
      reply("not json"),
      reply('{"name":"x","terms":["1","2","3","4"]}'),
    ]);
    await expect(llm.callStructured(call)).rejects.toBeInstanceOf(LlmOutputError);
    expect(client.create).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  it.each(["max_tokens", "model_context_window_exceeded"])(
    "does not retry output cut off by %s (the same request would be cut off again)",
    async (stopReason) => {
      const { llm, client, rows } = setup([
        reply('{"name":"Invo', { stopReason }),
        reply('{"name":"Invoicer","terms":[]}'),
      ]);
      const error = await llm.callStructured(call).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmTruncatedError);
      expect(error).toBeInstanceOf(LlmOutputError);
      expect(client.create).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    },
  );

  it("keeps a paid reply when the usage row cannot be written, after one retry", async () => {
    const { llm, usage } = setup([reply('{"name":"Invoicer","terms":[]}')]);
    const failure = Object.assign(new Error("db down"), { name: "PostgrestError" });
    vi.mocked(usage.record).mockRejectedValue(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await llm.callStructured(call)).toEqual({ name: "Invoicer", terms: [] });
    expect(usage.record).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("[llm] usage row not written: PostgrestError");
    log.mockRestore();
  });

  it.each([
    ["product_monthly", { product: 2.998 }],
    ["global_daily", { global: 24.998 }],
  ] as const)(
    "counts spend it could not record against the %s cap, so a lost row cannot open the cap",
    async (cap, spend) => {
      const { llm, usage, client } = setup(
        [reply('{"name":"Invoicer","terms":[]}'), reply('{"name":"Invoicer","terms":[]}')],
        spend,
      );
      vi.mocked(usage.record).mockRejectedValue(new Error("db down"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await llm.callStructured(call); // $0.004, not recorded: now over the cap
      const error = await llm.callStructured(call).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmCapError);
      expect((error as LlmCapError).cap).toBe(cap);
      expect(client.create).toHaveBeenCalledTimes(1);
      log.mockRestore();
    },
  );

  it("refuses a product-less call for anything but the preview", async () => {
    const { llm, client } = setup([reply("{}")]);
    await expect(llm.callStructured({ ...call, productId: null })).rejects.toThrow(
      /needs a product/,
    );
    expect(client.create).not.toHaveBeenCalled();
  });

  it("refuses more than four cached system blocks (the API's limit)", async () => {
    const { llm, client } = setup([reply("{}")]);
    const system = Array.from({ length: 5 }, (_, i) => ({ text: `block ${i}`, cache: true }));
    await expect(llm.callStructured({ ...call, system })).rejects.toThrow(/At most 4/);
    expect(client.create).not.toHaveBeenCalled();
  });

  it("raises LlmRefusalError on a refusal, records its usage, and does not retry", async () => {
    const { llm, client, rows } = setup([reply("", { stopReason: "refusal" })]);
    await expect(llm.callStructured(call)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it("stops before calling when the product's monthly cap is spent", async () => {
    const { llm, client, usage } = setup([reply("{}")], { product: 3 });
    const error = await llm.callStructured(call).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmCapError);
    expect((error as LlmCapError).cap).toBe("product_monthly");
    expect(client.create).not.toHaveBeenCalled();
    expect(usage.spendSince).toHaveBeenCalledWith({
      productId: "p1",
      since: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it("stops before calling when the global daily cap is spent", async () => {
    const { llm, client, usage } = setup([reply("{}")], { global: 25 });
    const error = await llm.callStructured(call).catch((e: unknown) => e);
    expect((error as LlmCapError).cap).toBe("global_daily");
    expect(client.create).not.toHaveBeenCalled();
    expect(usage.spendSince).toHaveBeenCalledWith({
      productId: null,
      since: new Date("2026-10-16T00:00:00Z"),
    });
  });

  it("checks only the global cap when a call has no product (the preview)", async () => {
    const { llm, usage } = setup([reply('{"name":"P","terms":[]}')]);
    await llm.callStructured({
      ...call,
      task: "preview",
      productId: null,
      model: "claude-haiku-5-5",
    });
    expect(usage.spendSince).toHaveBeenCalledTimes(1);
  });

  it("does not retry the second attempt once the cap is reached", async () => {
    const spent = { product: 2.99 };
    const { llm, client, usage } = setup(
      [reply("not json"), reply('{"name":"Invoicer","terms":[]}')],
      spent,
    );
    vi.mocked(usage.record).mockImplementation(async () => {
      spent.product = 3.5;
    });
    await expect(llm.callStructured(call)).rejects.toBeInstanceOf(LlmCapError);
    expect(client.create).toHaveBeenCalledTimes(1);
  });
});

describe("prices", () => {
  it("records the plan's prices per million tokens", () => {
    expect(PRICES["claude-haiku-5-5"]).toMatchObject({ input: 0.1, output: 0.5 });
    expect(PRICES["claude-sonnet-5-5"]).toMatchObject({ input: 2, output: 10, cacheRead: 0.2 });
  });

  it("charges Haiku 5.5's long-prompt rates past 100K prompt tokens", () => {
    const short = costUsd("claude-haiku-5-5", {
      inputTokens: 100_000,
      outputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const long = costUsd("claude-haiku-5-5", {
      inputTokens: 100_001,
      outputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(short).toBeCloseTo(0.01 + 0.0005, 9);
    expect(long).toBeCloseTo(100_001 * 0.5e-6 + 1000 * 2.5e-6, 9);
  });

  it("counts cached tokens toward Haiku 5.5's 100K prompt threshold", () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadTokens: 99_001,
      cacheWriteTokens: 0,
    };
    // 100,001 prompt tokens in all: the long-prompt card, cache reads at 0.1x its $0.50 input rate.
    expect(costUsd("claude-haiku-5-5", usage)).toBeCloseTo(1_000 * 0.5e-6 + 99_001 * 0.05e-6, 9);
  });
});

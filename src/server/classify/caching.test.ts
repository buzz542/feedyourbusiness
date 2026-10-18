import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLlmClient } from "@/server/llm/anthropic";
import { createLlm } from "@/server/llm/llm";
import type { UsageRow } from "@/server/llm/ports";
import type { ClassifyItem } from "@/server/pipeline/collect-step";
import { createClassifier, type ClassifyProduct } from "./classify";
import { CLASSIFY_STATIC, MIN_CACHEABLE_TOKENS } from "./prompt";

/**
 * Prompt caching for classification (docs/PLAN.md 8.2): the static block is long enough to cache,
 * every batch sends the same cached prefix, and a cache hit reaches `llm_usage` and the cost.
 *
 * tests/fixtures/classify/cache-pair.json is synthetic: two Messages API responses shaped like the
 * documented ones (a cache write, then a read), not a live capture. CI never calls the API; the
 * live check is `npm run eval:classifier -- --live` (F16), which prints the second batch's
 * cache_read_input_tokens.
 */

const fixture = (name: string) => readFileSync(`tests/fixtures/classify/${name}`, "utf8");
const ITEMS = JSON.parse(fixture("posts-batch.json")) as ClassifyItem[];
const PAIR = JSON.parse(fixture("cache-pair.json")) as unknown[];

const product = (name: string): ClassifyProduct => ({
  name,
  oneLiner: "Invoices that chase themselves",
  description: "A small tool for freelancers.",
  audience: "Freelancers",
  competitors: [{ key: "c1", id: "comp-1", name: "Ledgerly", aliases: [], domain: null }],
});

function setup() {
  const requests: Array<{ system: unknown }> = [];
  let next = 0;
  const create = async (params: { system: unknown }) => {
    requests.push(params);
    return PAIR[Math.min(next++, PAIR.length - 1)];
  };
  const rows: UsageRow[] = [];
  const llm = createLlm({
    client: createLlmClient({ create } as never),
    usage: { record: async (row) => void rows.push(row), spendSince: async () => 0 },
    clock: () => new Date("2026-10-18T09:00:00Z"),
  });
  const classifier = createClassifier({
    llm,
    product: async (id) => product(id === "p1" ? "Invoicer" : "Scheduler"),
  });
  return { classifier, requests, rows };
}

describe("prompt caching", () => {
  it("the static block clears Haiku 5.5's minimum cacheable prefix with room to spare", () => {
    // Every whitespace-separated word is at least one token, so this undercounts the tokens.
    const words = CLASSIFY_STATIC.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThan(MIN_CACHEABLE_TOKENS * 1.25);
  });

  it("sends the same cached prefix with every batch, and the static block across products", async () => {
    const { classifier, requests } = setup();
    await classifier.classify("p1", ITEMS);
    await classifier.classify("p1", ITEMS.slice(0, 2));
    await classifier.classify("p2", ITEMS);
    const systems = requests.map((r) => r.system as Array<Record<string, unknown>>);
    for (const system of systems)
      expect(system.map((b) => b.cache_control)).toEqual([
        { type: "ephemeral" },
        { type: "ephemeral" },
      ]);
    expect(systems[1]).toEqual(systems[0]);
    expect(systems[2]![0]).toEqual(systems[0]![0]);
    expect(systems[2]![1]).not.toEqual(systems[0]![1]);
  });

  it("records the second batch's cache read in llm_usage, at the cheaper rate", async () => {
    const { classifier, rows } = setup();
    await classifier.classify("p1", ITEMS);
    await classifier.classify("p1", ITEMS);
    expect(rows.map((r) => [r.task, r.cache_write_tokens, r.cache_read_tokens])).toEqual([
      ["classify", 1468, 0],
      ["classify", 0, 1468],
    ]);
    expect(rows[1]!.cache_read_tokens).toBeGreaterThan(0);
    expect(rows[1]!.cost_usd).toBeLessThan(rows[0]!.cost_usd);
  });
});

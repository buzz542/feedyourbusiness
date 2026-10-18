import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Llm, StructuredCall } from "@/server/llm/llm";
import { LlmRefusalError } from "@/server/llm/llm";
import type { ClassifyItem } from "@/server/pipeline/collect-step";
import { createClassifier, type ProductLoader } from "./classify";
import { CLASSIFY_STATIC } from "./prompt";
import { toClassifyProduct } from "./supabase-product";
import type { Classification, ClassificationResult } from "./schema";

/** Haiku classification with post-processing (docs/PLAN.md 8.2), with a fake model. */

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(`tests/fixtures/classify/${name}`, "utf8")) as T;
const ITEMS = fixture<ClassifyItem[]>("posts-batch.json");
const REPLY = fixture<Classification>("reply-batch.json");

const product: ProductLoader = async () => ({
  name: "Invoicer",
  oneLiner: "Invoices that chase themselves",
  description: "A small tool for freelancers.",
  audience: "Freelancers",
  competitors: [
    {
      key: "c1",
      id: "comp-ledgerly",
      name: "Ledgerly",
      aliases: ["LDG"],
      domain: "ledgerly.example",
    },
  ],
});

function fakeLlm(reply: Classification | Error) {
  const calls: StructuredCall<unknown>[] = [];
  const llm: Llm = {
    capReached: async () => null,
    async callStructured<T>(call: StructuredCall<T>): Promise<T> {
      calls.push(call as StructuredCall<unknown>);
      if (reply instanceof Error) throw reply;
      return call.schema.parse(reply);
    },
  };
  return { llm, calls };
}

const result = (over: Partial<ClassificationResult>): ClassificationResult => ({
  id: "0",
  relevance: 80,
  category: "looking_for_tool",
  reason: "Asks for a tool.",
  highlight: "",
  tool_mentioned: null,
  competitor_key: null,
  rival: null,
  ...over,
});

async function classify(results: ClassificationResult[], items = ITEMS) {
  const { llm } = fakeLlm({ results });
  return createClassifier({ llm, product }).classify("p1", items);
}

describe("the classifier", () => {
  it("asks Haiku with the cached prompt, the batch inside <posts>, at low effort", async () => {
    const { llm, calls } = fakeLlm(REPLY);
    await createClassifier({ llm, product }).classify("p1", ITEMS);
    const call = calls[0]!;
    expect(call).toMatchObject({
      task: "classify",
      productId: "p1",
      model: "claude-haiku-5-5",
      effort: "low",
    });
    expect(call.system).toEqual([
      { text: CLASSIFY_STATIC, cache: true },
      { text: expect.stringContaining("Name: Invoicer"), cache: true },
    ]);
    expect(call.system[1]!.text).toContain("- key c1: Ledgerly (also: LDG) [ledgerly.example]");
    expect(call.input.startsWith("<posts>") && call.input.endsWith("</posts>")).toBe(true);
    expect(JSON.parse(call.input.slice(7, -8))).toEqual(ITEMS);
  });

  it("maps the recorded reply: relevant posts kept with their labels, the rest discarded", async () => {
    const { llm } = fakeLlm(REPLY);
    const labels = await createClassifier({ llm, product }).classify("p1", ITEMS);
    expect(labels).toEqual([
      {
        id: "0",
        relevance: 86,
        category: "looking_for_tool",
        reason: "Asks for a tool that sends invoice reminders automatically.",
        highlight: { start: 21, end: 58 },
        toolMentioned: null,
        competitorId: null,
        rival: null,
      },
      {
        id: "1",
        relevance: 74,
        category: "mentions_competitor",
        reason: "Unhappy with a competitor's new pricing and looking for another option.",
        highlight: { start: 9, end: 31 },
        toolMentioned: "Ledgerly",
        competitorId: "comp-ledgerly",
        rival: {
          issue: "pricing",
          sentiment: "negative",
          switching: true,
          summary:
            "Finds the competitor too expensive after a price rise and is looking elsewhere.",
        },
      },
    ]);
  });

  it("drops ids it did not send, and a second result for the same id", async () => {
    const labels = await classify([
      result({ id: "0" }),
      result({ id: "0", relevance: 99 }),
      result({ id: "7" }),
      result({ id: "x" }),
    ]);
    expect(labels.map((l) => [l.id, l.relevance])).toEqual([["0", 80]]);
  });

  it("discards not_relevant and anything under 40", async () => {
    const labels = await classify([
      result({ id: "0", relevance: 40 }),
      result({ id: "1", relevance: 39 }),
      result({ id: "2", relevance: 95, category: "not_relevant" }),
    ]);
    expect(labels.map((l) => l.id)).toEqual(["0"]);
  });

  it("turns the highlight into offsets only on an exact match", async () => {
    const labels = await classify([
      result({ id: "0", highlight: "invoice reminders" }),
      result({ id: "1", highlight: "RAISED ITS PRICE" }),
      result({ id: "2", highlight: "a phrase that is not in the post" }),
    ]);
    expect(labels.map((l) => l.highlight)).toEqual([{ start: 27, end: 44 }, null, null]);
  });

  it.each([
    "@ledgerly_app",
    "u/someone",
    "someone@example.test",
    "https://ledgerly.example",
    "www.ledgerly.example",
    "ledgerly.example/pricing",
  ])("rejects %j as a tool name", async (tool) => {
    const [label] = await classify([result({ tool_mentioned: tool })]);
    expect(label!.toolMentioned).toBeNull();
  });

  it("keeps a plain product name", async () => {
    const [label] = await classify([result({ tool_mentioned: "  Ledgerly  " })]);
    expect(label!.toolMentioned).toBe("Ledgerly");
  });

  it("accepts only its own competitor keys", async () => {
    const labels = await classify([
      result({ id: "0", competitor_key: "c1" }),
      result({ id: "1", competitor_key: "c9" }),
    ]);
    expect(labels.map((l) => l.competitorId)).toEqual(["comp-ledgerly", null]);
  });

  it("keeps rival details only when a tool or a competitor is named", async () => {
    const rival = {
      issue: "pricing" as const,
      sentiment: "negative" as const,
      switching: false,
      summary: "Too expensive.",
    };
    const labels = await classify([
      result({ id: "0", rival }),
      result({ id: "1", rival, tool_mentioned: "Ledgerly" }),
      result({ id: "2", rival, tool_mentioned: "@nobody" }),
    ]);
    expect(labels.map((l) => l.rival !== null)).toEqual([false, true, false]);
  });

  it("throws a refusal for the caller to skip and count", async () => {
    const { llm } = fakeLlm(new LlmRefusalError());
    await expect(createClassifier({ llm, product }).classify("p1", ITEMS)).rejects.toBeInstanceOf(
      LlmRefusalError,
    );
  });

  it("loads a product's context once per classifier", async () => {
    const loader = vi.fn(product);
    const { llm } = fakeLlm(REPLY);
    const classifier = createClassifier({ llm, product: loader });
    await classifier.classify("p1", ITEMS);
    await classifier.classify("p1", ITEMS);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("the product context", () => {
  it("keys competitors c1, c2 in order and fills missing profile fields with empty text", () => {
    expect(
      toClassifyProduct({ name: "Invoicer", one_liner: null, description: null, audience: null }, [
        { id: "a", name: "Ledgerly", aliases: [], domain: null },
        { id: "b", name: "Paidly", aliases: ["PDL"], domain: "paidly.example" },
      ]),
    ).toEqual({
      name: "Invoicer",
      oneLiner: "",
      description: "",
      audience: "",
      competitors: [
        { key: "c1", id: "a", name: "Ledgerly", aliases: [], domain: null },
        { key: "c2", id: "b", name: "Paidly", aliases: ["PDL"], domain: "paidly.example" },
      ],
    });
  });
});

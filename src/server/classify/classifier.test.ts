import { describe, expect, it } from "vitest";
import { createLlm, LlmCapError, LlmRefusalError } from "@/server/llm/llm";
import { FakeLlmClient, FakeUsageStore } from "@/server/llm/fakes";
import type { LlmReply } from "@/server/llm/ports";
import { createCollectHandler } from "@/server/pipeline/collect";
import { createCollectStep, type ClassifyItem } from "@/server/pipeline/collect-step";
import { FakeBudget, FakeCollectStore, FakeJobStore } from "@/server/pipeline/fakes";
import { runJobs } from "@/server/pipeline/runner";
import type { CollectSource } from "@/sources/types";
import {
  CLASSIFY_MODEL,
  cleanToolName,
  createClassifier,
  highlightOffsets,
  type ProductProfile,
} from "./classifier";
import { CLASSIFY_SYSTEM } from "./prompt";
import type { ClassificationResult } from "./schema";
import { createSpendCapCheck } from "./spend";

/** The Haiku classifier (docs/PLAN.md 8.2) with a fake model. Every post and name is invented. */

const NOW = new Date("2026-11-02T12:00:00Z");
const PRODUCT = "product-1";
const CAPS = { productMonthlyUsd: 3, dailyUsd: 25 };

const profile: ProductProfile = {
  name: "Dunning Duck",
  oneLiner: "Chases unpaid invoices for freelancers.",
  description: null,
  audience: "Freelancers",
  aliases: [],
  competitors: [
    { id: "rival-a", name: "Acme Invoices", aliases: ["Acme"] },
    { id: "rival-b", name: "Ledgerly", aliases: [] },
  ],
};

const items: ClassifyItem[] = [
  {
    id: "0",
    source: "hackernews",
    community: "Hacker News",
    excerpt: "Is there a tool that chases unpaid invoices? 🙏 Acme is too pricey.",
  },
  { id: "1", source: "bluesky", community: "Bluesky", excerpt: "My cat learned to open doors." },
  {
    id: "2",
    source: "reddit",
    community: "r/freelance",
    excerpt: "Ledgerly support never answers, thinking of switching.",
  },
];

type Result = ClassificationResult["results"][number];
const result = (over: Partial<Result> & { id: string }): Result => ({
  relevance: 80,
  category: "looking_for_tool",
  reason: "Asks for a tool that chases invoices.",
  highlight: "",
  tool_mentioned: null,
  competitor_key: null,
  rival: null,
  ...over,
});

const reply = (results: Result[], over: Partial<LlmReply> = {}): LlmReply => ({
  stopReason: "end_turn",
  text: JSON.stringify({ results }),
  usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ...over,
});

function setup(
  replies: ConstructorParameters<typeof FakeLlmClient>[0],
  usage = new FakeUsageStore(),
) {
  const client = new FakeLlmClient(replies);
  const llm = createLlm({ client, usage, clock: { now: () => NOW }, caps: CAPS });
  const classifier = createClassifier({ llm, profiles: { profile: async () => profile } });
  return { client, usage, classifier };
}

describe("the request", () => {
  it("sends Haiku two cached system blocks and only id, source, community and excerpt", async () => {
    const { client, classifier } = setup([reply([])]);
    await classifier.classify(PRODUCT, items);
    const request = client.requests[0]!;
    expect(request.model).toBe(CLASSIFY_MODEL);
    expect(request.effort).toBe("low");
    expect(request.system).toHaveLength(2);
    expect(request.system.every((b) => b.cache)).toBe(true);
    expect(request.system[0]!.text).toBe(CLASSIFY_SYSTEM);
    expect(request.system[1]!.text).toContain("c1: Acme Invoices (Acme)");
    expect(request.system[1]!.text).toContain("c2: Ledgerly");
    const sent = JSON.parse(request.input) as Record<string, unknown>[];
    expect(sent.map((s) => Object.keys(s).sort())).toEqual(
      items.map(() => ["community", "excerpt", "id", "source"]),
    );
  });

  it("makes no call for an empty batch or a product that is gone", async () => {
    const { client, classifier } = setup([]);
    expect(await classifier.classify(PRODUCT, [])).toEqual([]);
    const gone = createClassifier({
      llm: createLlm({
        client,
        usage: new FakeUsageStore(),
        clock: { now: () => NOW },
        caps: CAPS,
      }),
      profiles: { profile: async () => null },
    });
    expect(await gone.classify(PRODUCT, items)).toEqual([]);
    expect(client.requests).toHaveLength(0);
  });

  it("refuses a batch over 20 before any call", async () => {
    const { client, classifier } = setup([]);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...items[0]!, id: String(i) }));
    await expect(classifier.classify(PRODUCT, many)).rejects.toThrow(RangeError);
    expect(client.requests).toHaveLength(0);
  });
});

describe("post-processing", () => {
  it("drops ids it did not send and keeps the first answer for an id", async () => {
    const { classifier } = setup([
      reply([result({ id: "0" }), result({ id: "0", relevance: 99 }), result({ id: "7" })]),
    ]);
    const labels = await classifier.classify(PRODUCT, items);
    expect(labels.map((l) => [l.id, l.relevance])).toEqual([["0", 80]]);
  });

  it("discards not_relevant and relevance below 40, and any score that is not a whole 0 to 100", async () => {
    const { classifier } = setup([
      reply([
        result({ id: "0", relevance: 39 }),
        result({ id: "1", relevance: 90, category: "not_relevant" }),
        result({ id: "2", relevance: 40, category: "pain_point" }),
      ]),
    ]);
    expect((await classifier.classify(PRODUCT, items)).map((l) => l.id)).toEqual(["2"]);
    const odd = setup([
      reply([result({ id: "0", relevance: 55.5 }), result({ id: "2", relevance: 101 })]),
    ]);
    expect(await odd.classifier.classify(PRODUCT, items)).toEqual([]);
  });

  it("turns a highlight into code-point offsets by exact match only", async () => {
    const { classifier } = setup([
      reply([
        result({ id: "0", highlight: "Acme is too pricey" }),
        result({ id: "2", highlight: "support never ANSWERS" }),
      ]),
    ]);
    const [first, second] = await classifier.classify(PRODUCT, items);
    // The emoji before the phrase counts once, as Postgres counts it.
    expect(first!.highlight).toEqual({ start: 47, end: 65 });
    expect(Array.from(items[0]!.excerpt).slice(47, 65).join("")).toBe("Acme is too pricey");
    expect(second!.highlight).toBeNull();
    expect(highlightOffsets("abc", "")).toBeNull();
    expect(highlightOffsets("abc", "x".repeat(141))).toBeNull();
  });

  it.each([
    ["@acme_founder"],
    ["u/acme_founder"],
    ["founder@acme.example"],
    ["https://acme.example/pricing"],
    ["acme.example/pricing"],
    ["   "],
    ["x".repeat(61)],
  ])("rejects the tool name %j", (tool) => {
    expect(cleanToolName(tool)).toBeNull();
  });

  it("keeps a plain product or company name", () => {
    expect(cleanToolName(" Acme Invoices ")).toBe("Acme Invoices");
    expect(cleanToolName("Cal.com")).toBe("Cal.com");
  });

  it("keeps only our competitor keys, and a rival label only next to a tool or competitor", async () => {
    const rival = {
      issue: "support" as const,
      sentiment: "negative" as const,
      switching: true,
      summary: "Unhappy with how slowly support replies.",
    };
    const { classifier } = setup([
      reply([
        result({ id: "0", competitor_key: "c9", rival }),
        result({
          id: "1",
          category: "mentions_competitor",
          competitor_key: null,
          tool_mentioned: "@someone",
          rival,
        }),
        result({ id: "2", category: "mentions_competitor", competitor_key: "c2", rival }),
      ]),
    ]);
    const labels = await classifier.classify(PRODUCT, items);
    expect(
      labels.map((l) => [l.id, l.competitorId, l.toolMentioned, l.rival?.issue ?? null]),
    ).toEqual([
      ["0", null, null, null],
      ["1", null, null, null],
      ["2", "rival-b", null, "support"],
    ]);
  });

  it("drops a rival summary that names a person or a link, and cuts long text", async () => {
    const { classifier } = setup([
      reply([
        result({
          id: "0",
          tool_mentioned: "Acme Invoices",
          reason: "r".repeat(300),
          rival: {
            issue: "pricing",
            sentiment: "negative",
            switching: false,
            summary: "See https://acme.example for more.",
          },
        }),
      ]),
    ]);
    const [label] = await classifier.classify(PRODUCT, items);
    expect(label!.rival).toBeNull();
    expect(Array.from(label!.reason)).toHaveLength(160);
  });
});

describe("refusals and spend caps", () => {
  it("raises LlmRefusalError on a refusal, which the collect step skips and counts", async () => {
    const { classifier } = setup([reply([], { stopReason: "refusal", text: "" })]);
    await expect(classifier.classify(PRODUCT, items)).rejects.toThrow(LlmRefusalError);
  });

  it.each([
    ["product_monthly", { productId: PRODUCT, costUsd: 3, at: NOW }],
    ["global_daily", { productId: "another-product", costUsd: 25, at: NOW }],
  ] as const)("stops at the %s cap before calling the model", async (cap, seed) => {
    const usage = new FakeUsageStore();
    usage.seed(seed);
    const { client, classifier } = setup([reply([])], usage);
    await expect(classifier.classify(PRODUCT, items)).rejects.toEqual(new LlmCapError(cap));
    expect(client.requests).toHaveLength(0);
    const check = createSpendCapCheck({ usage, caps: CAPS, clock: { now: () => NOW } });
    expect(await check(PRODUCT)).toBe(cap);
  });

  it.each([
    ["product_monthly", { productId: PRODUCT, costUsd: 3, at: NOW }],
    ["global_daily", { productId: "another-product", costUsd: 25, at: NOW }],
  ] as const)("shows the %s cap in the job result", async (cap, seed) => {
    const usage = new FakeUsageStore();
    usage.seed(seed);
    const { classifier } = setup([], usage);
    const source = {
      id: "hackernews",
      linkHosts: ["news.ycombinator.com"],
      costPerUnitUsd: 0,
      dailyBudget: 300,
      credentials: [],
      start: async () => ({
        kind: "done" as const,
        units: 1,
        posts: [
          {
            externalId: "41000001",
            url: "https://news.ycombinator.com/item?id=41000001",
            excerpt: "Is there a tool that chases unpaid invoices for freelancers?",
            postedAt: new Date(NOW.getTime() - 3_600_000),
            authorKey: "invented_author_1",
            community: "Hacker News",
            termId: "term-1",
            nsfw: false,
          },
        ],
      }),
    } as unknown as CollectSource;
    const jobs = new FakeJobStore();
    await jobs.enqueue([
      {
        kind: "collect",
        productId: PRODUCT,
        source: "hackernews",
        dedupeKey: "collect:1",
        runAfter: NOW,
      },
    ]);
    const posts = new FakeCollectStore();
    const handler = createCollectHandler({
      sourceFor: () => source,
      // A free source that never fetches: its posts come from start() above.
      fetchFor: () =>
        (async () => {
          throw new Error("no network in tests");
        }) as never,
      budget: new FakeBudget(jobs),
      terms: async () => [{ id: "term-1", term: "unpaid invoices" }],
      process: createCollectStep({ store: posts, classifier, hash: (s, k) => `hash:${s}:${k}` }),
      monthlyCap: () => null,
      userAgent: "test",
    });
    await runJobs({ store: jobs, handlers: { collect: handler }, clock: () => NOW });
    expect(jobs.jobs[0]).toMatchObject({
      status: "done",
      payload: { result: "ok", stored: 0, capped: cap },
    });
    expect(posts.posts.size).toBe(0);
  });
});

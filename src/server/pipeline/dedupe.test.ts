import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { reddit } from "@/sources/reddit";
import type { CollectContext, CollectedPost } from "@/sources/types";
import { createCollectStep, type Classifier } from "./collect-step";
import { FakeCollectStore } from "./fakes";
import type { Job } from "./ports";

/**
 * Dedupe end to end (M4): the real Reddit mapping, then the collect step for two products. The same
 * post found by two terms and through two URL forms becomes one post, classified once per product,
 * stored once, and linked once per product, however often the jobs run. tests/db/dedupe.test.ts
 * checks the same guarantees in Postgres.
 */

const NOW = new Date("2026-10-17T09:00:00Z");
const SINCE = new Date("2026-10-15T09:00:00Z");
const TERMS = [
  { id: "t-invoice", term: "invoice reminders" },
  { id: "t-fees", term: "late fees" },
];

const record = (keyword: string, url: string) => ({
  ...JSON.parse(readFileSync("tests/fixtures/reddit/snapshot.json", "utf8"))[0],
  url,
  discovery_input: { keyword },
});

async function collectReddit(): Promise<CollectedPost[]> {
  const snapshot = JSON.stringify([
    record(
      "invoice reminders",
      "https://www.reddit.com/r/freelance/comments/1exa001/example_post_1exa001/",
    ),
    record(
      "late fees",
      "https://old.reddit.com/r/freelance/comments/1exa001/example_post_1exa001/?utm_source=share",
    ),
  ]);
  const http = vi.fn(async (input: string | URL) =>
    String(input).includes("/progress/")
      ? new Response(JSON.stringify({ status: "ready" }))
      : new Response(snapshot),
  );
  const ctx: CollectContext = {
    fetch: http,
    terms: TERMS,
    since: SINCE,
    budget: 120,
    now: NOW,
    userAgent: "AskedFor/1.0 (+https://askedfor.app; hello@askedfor.app)",
    sleep: async () => {},
    credential: (name) =>
      ({ BRIGHTDATA_API_TOKEN: "t", BRIGHTDATA_REDDIT_DATASET_ID: "gd_lvz8ah06191smkebj4" })[name],
  };
  const handle = JSON.stringify({
    p: "brightdata",
    h: "s_example0001",
    t: TERMS.map((t) => [t.id, t.term]),
  });
  const state = await reddit.poll!(ctx, handle);
  if (state.kind !== "done") throw new Error(JSON.stringify(state));
  return state.posts;
}

const job = (productId: string): Job => ({
  id: `job-${productId}`,
  kind: "collect",
  productId,
  source: "reddit",
  status: "running",
  payload: { day: "2026-10-17" },
  attempts: 1,
  runAfter: NOW,
});

describe("dedupe", () => {
  it("one post from two terms and two URL forms: one row, classified and linked once per product", async () => {
    const posts = await collectReddit();
    expect(posts.map((p) => [p.externalId, p.url])).toEqual([
      ["1exa001", "https://www.reddit.com/r/freelance/comments/1exa001/example_post_1exa001/"],
    ]);

    const store = new FakeCollectStore();
    const classify = vi.fn<Classifier["classify"]>(async (_productId, items) =>
      items.map((i) => ({
        id: i.id,
        relevance: 70,
        category: "looking_for_tool" as const,
        reason: "Asks for a tool.",
        highlight: null,
        toolMentioned: null,
        competitorId: null,
        rival: null,
      })),
    );
    const step = createCollectStep({
      store,
      classifier: { classify },
      hash: (s, k) => `${s}:${k}`,
    });
    const run = (productId: string) =>
      step({ job: job(productId), source: reddit, posts, now: NOW, since: SINCE, terms: TERMS });

    await run("p1");
    await run("p2");
    await run("p1"); // a repeat run for p1 classifies nothing new
    await run("p2");

    expect(store.posts.size).toBe(1);
    expect(store.links.map((l) => l.productId)).toEqual(["p1", "p2"]);
    expect(classify.mock.calls.map(([productId, items]) => [productId, items.length])).toEqual([
      ["p1", 1],
      ["p2", 1],
    ]);
  });
});

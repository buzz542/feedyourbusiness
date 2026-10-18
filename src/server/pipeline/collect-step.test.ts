import { describe, expect, it, vi } from "vitest";
import { sources } from "@/sources/registry";
import type { CollectedPost, CollectSource } from "@/sources/types";
import {
  BATCH_SIZE,
  createCollectStep,
  type Classifier,
  type ClassifyItem,
  type Label,
} from "./collect-step";
import { FakeCollectStore } from "./fakes";
import type { Job } from "./ports";

/**
 * The collect step (docs/PLAN.md 7.3, steps 5 to 9) with a fake store and a fake classifier: what is
 * dropped before the model, what is classified, what is stored and linked, and the term counts.
 */

const NOW = new Date("2026-10-17T09:00:00Z");
const SINCE = new Date("2026-10-15T09:00:00Z");
const hash = (source: string, key: string) => `h:${source}:${key.toLowerCase()}`;

const hn = sources.find((s) => s.id === "hackernews") as CollectSource;
const collectSources = sources.filter((s): s is CollectSource => s.mode === "collect");

const LINKS: Record<string, (id: string) => string> = {
  hackernews: (id) => `https://news.ycombinator.com/item?id=${id}`,
  bluesky: (id) => `https://bsky.app/profile/did:plc:example/post/${id}`,
  reddit: (id) => `https://www.reddit.com/r/SaaS/comments/${id}/x/`,
  x: (id) => `https://x.com/i/web/status/${id}`,
};

function post(id: string, over: Partial<CollectedPost> = {}, source = "hackernews"): CollectedPost {
  return {
    externalId: id,
    url: LINKS[source]!(id),
    excerpt: `Looking for a tool to chase invoices (${id})`,
    postedAt: new Date("2026-10-17T06:00:00Z"),
    authorKey: `example_author_${id}`,
    community: "Hacker News",
    termId: "t-invoice",
    nsfw: false,
    ...over,
  };
}

const job = (over: Partial<Job> = {}): Job => ({
  id: "job-1",
  kind: "collect",
  productId: "p1",
  source: "hackernews",
  status: "running",
  payload: { day: "2026-10-17" },
  attempts: 1,
  runAfter: NOW,
  ...over,
});

/** Labels every item with the relevance its excerpt asks for ("rel=NN"), 70 by default. */
function fakeClassifier(over: (item: ClassifyItem) => Partial<Label> = () => ({})) {
  return {
    classify: vi.fn<Classifier["classify"]>(async (_productId, items) =>
      items.map((item) => {
        const asked = /rel=(\d+)/.exec(item.excerpt);
        return {
          id: item.id,
          relevance: asked ? Number(asked[1]) : 70,
          category: "looking_for_tool" as const,
          reason: "Asks for a tool that chases invoices.",
          ...over(item),
        };
      }),
    ),
  };
}

function setup(classifier = fakeClassifier()) {
  const store = new FakeCollectStore();
  const step = createCollectStep({ store, classifier, hash });
  const run = (posts: CollectedPost[], source: CollectSource = hn, j: Job = job()) =>
    step({ job: j, source, posts, now: NOW, since: SINCE });
  return { store, classifier, run };
}

describe("the collect step", () => {
  it("classifies new posts, stores the relevant ones and links them to the product", async () => {
    const { store, classifier, run } = setup();
    const result = await run([post("1"), post("2", { excerpt: "Nothing to do with it rel=10" })]);
    expect(result).toEqual({ stored: 1 });
    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect([...store.posts.values()].map((p) => p.externalId)).toEqual(["1"]);
    const stored = [...store.posts.values()][0]!;
    expect(stored).toMatchObject({ authorHash: "h:hackernews:example_author_1" });
    expect(stored).not.toHaveProperty("authorKey");
    expect(store.links).toEqual([
      {
        productId: "p1",
        postId: stored.id,
        relevance: 70,
        category: "looking_for_tool",
        reason: "Asks for a tool that chases invoices.",
      },
    ]);
  });

  it("discards not_relevant and anything under 40", async () => {
    const classifier = fakeClassifier((item) =>
      item.excerpt.includes("(3)") ? { category: "not_relevant", relevance: 90 } : {},
    );
    const { store, run } = setup(classifier);
    await run([
      post("1", { excerpt: "Borderline (1) rel=40" }),
      post("2", { excerpt: "Weak (2) rel=39" }),
      post("3"),
    ]);
    expect([...store.posts.values()].map((p) => p.externalId)).toEqual(["1"]);
  });

  it("never stores a suppressed author, from any source, and never sends one to the model", async () => {
    for (const source of collectSources) {
      const { store, classifier, run } = setup();
      const posts = [post("1", {}, source.id), post("2", {}, source.id)];
      store.suppression.add(`${source.id}|${hash(source.id, "example_author_1")}`);
      await run(posts, source, job({ source: source.id }));
      expect(
        [...store.posts.values()].map((p) => p.externalId),
        source.id,
      ).toEqual(["2"]);
      const sent = classifier.classify.mock.calls.flatMap(([, items]) => items);
      expect(sent.map((i) => i.excerpt).join(" "), source.id).not.toContain("(1)");
    }
  });

  it("refuses a suppressed author even when the pre-check misses it (ingest_post decides)", async () => {
    const { store, run } = setup();
    store.suppressedAtIngest.add(hash("hackernews", "example_author_1"));
    expect(await run([post("1")])).toEqual({ stored: 0 });
    expect(store.links).toEqual([]);
  });

  it("skips posts this product already has, without classifying them again", async () => {
    const { store, classifier, run } = setup();
    await run([post("1")]);
    classifier.classify.mockClear();
    expect(await run([post("1"), post("2")])).toEqual({ stored: 1 });
    expect(classifier.classify.mock.calls[0]![1].map((i) => i.excerpt)).toEqual([
      expect.stringContaining("(2)"),
    ]);
    expect(store.links).toHaveLength(2);
  });

  it("classifies a post stored for another product for this one, and links the same row", async () => {
    const { store, classifier, run } = setup();
    await run([post("1")], hn, job({ productId: "p-other" }));
    classifier.classify.mockClear();
    expect(await run([post("1")])).toEqual({ stored: 1 });
    expect(classifier.classify).toHaveBeenCalledWith("p1", [
      expect.objectContaining({ source: "hackernews" }),
    ]);
    expect(store.posts.size).toBe(1);
    expect(store.links.map((l) => l.productId)).toEqual(["p-other", "p1"]);
    expect(new Set(store.links.map((l) => l.postId)).size).toBe(1);
  });

  it("drops before the model: NSFW, outside the window, placeholder authors, off-host links, long excerpts and repeats", async () => {
    const { store, classifier, run } = setup();
    await run([
      post("1"),
      post("2", { nsfw: true }),
      post("3", { postedAt: new Date("2026-10-15T08:00:00Z") }),
      post("4", { authorKey: "[deleted]" }),
      post("5", { authorKey: "  @ " }),
      post("6", { url: "https://evil.example/item?id=6" }),
      post("7", { url: "http://news.ycombinator.com/item?id=7" }),
      post("8", { excerpt: "x".repeat(281) }),
      post("1"),
    ]);
    const sent = classifier.classify.mock.calls.flatMap(([, items]) => items);
    expect(sent).toHaveLength(1);
    expect([...store.posts.values()].map((p) => p.externalId)).toEqual(["1"]);
  });

  it("sends the model only an opaque id, the source, the community and the excerpt, 20 at a time", async () => {
    const { classifier, run } = setup();
    await run(Array.from({ length: 45 }, (_, i) => post(String(i + 1))));
    const batches = classifier.classify.mock.calls.map(([, items]) => items);
    expect(batches.map((b) => b.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 5]);
    for (const item of batches.flat()) {
      expect(Object.keys(item).sort()).toEqual(["community", "excerpt", "id", "source"]);
      expect(item.id).toMatch(/^\d{1,2}$/);
    }
  });

  it("ignores labels for ids it did not send", async () => {
    const classifier = {
      classify: vi.fn<Classifier["classify"]>(async (_p, items) => [
        { id: "999", relevance: 99, category: "wish", reason: "Invented." },
        ...items.map((i) => ({
          id: i.id,
          relevance: 80,
          category: "wish" as const,
          reason: "A wish.",
        })),
      ]),
    };
    const { store, run } = setup(classifier);
    expect(await run([post("1")])).toEqual({ stored: 1 });
    expect(store.links).toHaveLength(1);
  });

  it("adds the per-term counts once per job: posts fetched and posts kept", async () => {
    const { store, run } = setup();
    const posts = [
      post("1"),
      post("2", { excerpt: "Weak rel=20" }),
      post("3", { termId: "t-fees" }),
      post("4", { termId: null }),
    ];
    await run(posts);
    await run(posts); // the same job again, after a crash
    expect(store.termStats).toEqual([
      {
        jobId: "job-1",
        day: "2026-10-17",
        source: "hackernews",
        stats: [
          { termId: "t-invoice", fetched: 2, relevant: 1 },
          { termId: "t-fees", fetched: 1, relevant: 1 },
        ],
      },
    ]);
  });

  it("makes no model call when nothing is left to classify", async () => {
    const { classifier, run } = setup();
    expect(await run([post("1", { nsfw: true })])).toEqual({ stored: 0 });
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});

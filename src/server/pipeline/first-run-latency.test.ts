import { describe, expect, it, vi } from "vitest";
import { createWebhookHandler } from "@/server/billing/handlers";
import {
  FakeProfileStore,
  FakeStripe,
  subscriptionEvent,
  subscriptionFixture,
} from "@/server/billing/fakes";
import { startFirstRunAfterEvent } from "@/server/billing/first-run-trigger";
import type { CollectedPost, CollectSource, RunState } from "@/sources/types";
import { createCollectHandler } from "./collect";
import { createCollectStep, type Classifier } from "./collect-step";
import { FakeBudget, FakeCollectStore, FakeJobStore } from "./fakes";
import { startFirstRun } from "./first-run";
import { runJobs } from "./runner";

/**
 * Webhook to first stored post, with fakes (the founder, 26 Nov 2026): the subscription event
 * starts the first run and the same pass stores the first post, with no tick in between. The time
 * measured here is our own code path only; live sources and the model add their own latency, so
 * no public claim rests on it.
 */

const post = (id: string, now: Date): CollectedPost => ({
  externalId: id,
  url: `https://hn.example/item?id=${id}`,
  excerpt: `Example: looking for an airport transfer ${id}`,
  postedAt: new Date(now.getTime() - 3_600_000),
  authorKey: `example-author-${id}`,
  community: "Hacker News",
  termId: "t1",
  nsfw: false,
});

describe("first run from the webhook", () => {
  it("stores the first post in the webhook's own pass, and reports the time", async () => {
    const profiles = new FakeProfileStore();
    profiles.addUser("user-1");
    const jobs = new FakeJobStore();
    const posts = new FakeCollectStore();
    const now = () => new Date();
    let firstStoredAt: number | null = null;
    const ingest = posts.ingest.bind(posts);
    posts.ingest = async (p) => {
      firstStoredAt ??= performance.now();
      return ingest(p);
    };
    const hn: CollectSource = {
      id: "hackernews",
      displayName: "Hacker News",
      mode: "collect",
      access: "official_api",
      termsUrl: "https://terms.example/",
      allowedHosts: ["api.hn.example"],
      linkHosts: ["hn.example"],
      dailyBudget: 300,
      retentionDays: 30,
      costPerUnitUsd: 0,
      credentials: [],
      start: vi.fn(async (): Promise<RunState> => ({
        kind: "done",
        posts: [post("1", now()), post("2", now())],
        units: 2,
      })),
    };
    const classifier: Classifier = {
      classify: async (_p, items) =>
        items.map((item) => ({
          id: item.id,
          relevance: 70,
          category: "looking_for_tool" as const,
          reason: "Asks for an airport transfer.",
          highlight: null,
          toolMentioned: null,
          competitorId: null,
          rival: null,
        })),
    };
    const handlers = {
      first_run: createCollectHandler({
        sourceFor: (id) => (id === "hackernews" ? hn : null),
        fetchFor: () => vi.fn(),
        budget: new FakeBudget(jobs),
        terms: async () => [{ id: "t1", term: "airport transfer" }],
        process: createCollectStep({ store: posts, classifier, hash: (s, a) => `${s}:${a}` }),
        monthlyCap: () => null,
        userAgent: "FeedYourBusiness/test",
        sleep: async () => {},
      }),
    };

    const webhook = createWebhookHandler({
      stripe: new FakeStripe(),
      store: profiles,
      afterEvent: (event) =>
        startFirstRunAfterEvent(event, {
          store: profiles,
          productFor: async () => ({ id: "prod-1", status: "active" }),
          // As ensureFirstRun: enqueue once, then work the jobs (after() in production).
          startFirstRun: async (productId) => {
            await startFirstRun({ store: jobs, sources: [hn], productId, now: now() });
            await runJobs({ store: jobs, handlers, clock: now });
          },
        }),
    });

    const event = subscriptionEvent("created", subscriptionFixture());
    const startedAt = performance.now();
    const response = await webhook(
      new Request("https://app.example.test/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "valid-signature" },
        body: JSON.stringify(event),
      }),
    );

    expect(response.status).toBe(200);
    expect(posts.links).toHaveLength(2);
    expect(jobs.byKind("first_run")[0]!.status).toBe("done");
    expect(firstStoredAt).not.toBeNull();
    const ms = firstStoredAt! - startedAt;
    console.log(`[measure] webhook to first stored post, fakes: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1_000);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Llm, StructuredCall } from "@/server/llm/llm";
import type { CollectSource, CollectedPost } from "@/sources/types";
import { type PreviewDeps, runPreview } from "./preview";
import { PreviewResult } from "./schema";

/** The instant preview (docs/PLAN.md 8.5, 12.7), with fake sources, model and store. */

const NOW = new Date("2026-10-25T09:00:00Z");

const post = (id: string, over: Partial<CollectedPost> = {}): CollectedPost => ({
  externalId: id,
  url: `https://example.test/item/${id}`,
  excerpt: `Example post ${id}: looking for a simple invoice tool for my freelance work`,
  postedAt: new Date("2026-10-24T09:00:00Z"),
  authorKey: `author-${id}`,
  community: "Example",
  termId: "t0",
  nsfw: false,
  ...over,
});

function source(id: string, posts: CollectedPost[]) {
  const start = vi.fn(async () => ({ kind: "done" as const, posts, units: 1 }));
  return {
    src: {
      id,
      displayName: id,
      mode: "collect",
      access: id === "reddit" ? "vendor_api" : "official_api",
      termsUrl: "https://example.test/terms",
      allowedHosts: [`${id}.example.test`],
      linkHosts: [],
      dailyBudget: 10,
      retentionDays: 30,
      costPerUnitUsd: 0,
      credentials: [],
      requiredCredentials: [],
      start,
    } as unknown as CollectSource,
    start,
  };
}

/** A fake model: the draft, then a label per post (relevance from the map), then a theme. */
function fakeLlm(
  relevance: Record<string, number>,
  theme = { title: "Invoices", summary: "People want simpler invoicing." },
) {
  const calls: StructuredCall<unknown>[] = [];
  const llm: Llm = {
    capReached: async () => null,
    async callStructured<T>(call: StructuredCall<T>): Promise<T> {
      calls.push(call as StructuredCall<unknown>);
      if (call.input.startsWith("<page")) {
        return call.schema.parse({
          name: "Invoicer",
          one_liner: "Invoices that chase themselves",
          terms: ["invoice tool", "chase payments", "late invoices"],
        });
      }
      if (call.system.length === 2) {
        const items = JSON.parse(call.input.slice("<posts>".length, -"</posts>".length)) as {
          id: string;
          excerpt: string;
        }[];
        return call.schema.parse({
          results: items.map((it) => ({
            id: it.id,
            relevance: relevance[it.excerpt.split(":")[0]!.replace("Example post ", "")] ?? 0,
            category: "looking_for_tool",
            reason: "Asks for an invoice tool.",
            highlight: "invoice tool",
            tool_mentioned: null,
            competitor_key: null,
            rival: null,
          })),
        });
      }
      return call.schema.parse(theme);
    },
  };
  return { llm, calls };
}

function deps(over: Partial<PreviewDeps> = {}) {
  const hn = source("hackernews", [post("a"), post("b"), post("c", { nsfw: true })]);
  const bsky = source("bluesky", [post("d"), post("e", { authorKey: "blocked" })]);
  const reddit = source("reddit", [post("r")]);
  const x = source("x", [post("x")]);
  const started: Parameters<PreviewDeps["store"]["start"]>[0][] = [];
  const saved: { id: string; result: Parameters<PreviewDeps["store"]["finish"]>[1] }[] = [];
  const { llm, calls } = fakeLlm({ a: 90, b: 39, c: 95, d: 60, e: 99, r: 99, x: 99 });
  const d: PreviewDeps = {
    llm,
    siteText: vi.fn(async () => "Invoicer sends invoices that chase themselves."),
    sources: [hn.src, bsky.src, reddit.src, x.src],
    fetchFor: () => vi.fn(),
    credential: () => undefined,
    hash: (s, key) => `${s}:${key}`,
    suppressed: async (pairs) =>
      new Set(
        pairs
          .filter((p) => p.authorHash.endsWith(":blocked"))
          .map((p) => `${p.source}|${p.authorHash}`),
      ),
    store: {
      countIp: async () => 0,
      countAll: async () => 0,
      start: async (row) => {
        started.push(row);
        return `run-${started.length}`;
      },
      finish: async (id, result) => {
        saved.push({ id, result });
      },
    },
    userAgent: "AskedFor/1.0",
    sleep: async () => {},
    ...over,
  };
  return { d, hn, bsky, reddit, x, saved, started, calls };
}

describe("the instant preview", () => {
  it("shows up to 5 posts rated 40 or more from Hacker News and Bluesky only", async () => {
    const { d, reddit, x, saved, started, hn, bsky } = deps();
    const out = await runPreview(d, "invoicer.example", "ip-1", NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(hn.start).toHaveBeenCalledOnce();
    expect(bsky.start).toHaveBeenCalledOnce();
    // Reddit and X cost money per record: never called from the preview.
    expect(reddit.start).not.toHaveBeenCalled();
    expect(x.start).not.toHaveBeenCalled();
    // b is under 40, c is NSFW, e is a suppressed author.
    expect(out.result.posts.map((p) => p.url)).toEqual([
      "https://example.test/item/a",
      "https://example.test/item/d",
    ]);
    expect(out.result.theme).toEqual({
      title: "Invoices",
      summary: "People want simpler invoicing.",
    });
    expect(saved).toHaveLength(1);
    expect(started).toEqual([{ ipHash: "ip-1", urlHost: "invoicer.example" }]);
    expect(saved[0]!.id).toBe("run-1");
  });

  it("stores and returns a result with no author fields, valid against a strict schema", async () => {
    const { d, saved } = deps();
    await runPreview(d, "https://invoicer.example/pricing", "ip-1", NOW);
    const stored = saved[0]!.result;
    expect(PreviewResult.safeParse(stored).success).toBe(true);
    const json = JSON.stringify(stored);
    expect(json).not.toMatch(/author/i);
    // A planted author field is refused by the stored schema.
    const planted = structuredClone(stored);
    (planted.posts[0] as Record<string, unknown>).author_handle = "someone";
    expect(PreviewResult.safeParse(planted).success).toBe(false);
  });

  it("allows 3 previews per IP hash per day", async () => {
    const counts: Date[] = [];
    const { d } = deps({
      store: {
        countIp: async (_ip, since) => {
          counts.push(since);
          return 3;
        },
        countAll: async () => 0,
        start: async () => "run",
        finish: async () => {},
      },
    });
    expect(await runPreview(d, "invoicer.example", "ip-1", NOW)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(counts[0]).toEqual(new Date("2026-10-24T09:00:00Z"));
  });

  it("stops at the global daily cap", async () => {
    const { d, hn } = deps({
      globalCap: 200,
      store: {
        countIp: async () => 0,
        countAll: async () => 200,
        start: async () => "run",
        finish: async () => {},
      },
    });
    expect(await runPreview(d, "invoicer.example", "ip-1", NOW)).toEqual({
      ok: false,
      reason: "busy",
    });
    expect(hn.start).not.toHaveBeenCalled();
  });

  it.each([
    "https://www.reddit.com/r/SaaS",
    "x.com/someone",
    "https://news.ycombinator.com/item?id=1",
    "https://bsky.app/profile/someone",
    "https://www.linkedin.com/in/someone",
  ])("refuses a platform URL %s without fetching it", async (url) => {
    const { d } = deps();
    expect(await runPreview(d, url, "ip-1", NOW)).toEqual({ ok: false, reason: "platform_url" });
    expect(d.siteText).not.toHaveBeenCalled();
  });

  it.each([42, "", "ftp://invoicer.example", "http://"])(
    "refuses an invalid URL %j",
    async (url) => {
      const { d } = deps();
      expect(await runPreview(d, url, "ip-1", NOW)).toMatchObject({ ok: false });
      expect(d.siteText).not.toHaveBeenCalled();
    },
  );

  it("says so when the site cannot be read, and the attempt still counts", async () => {
    const { d, started } = deps({ siteText: async () => Promise.reject(new Error("timeout")) });
    expect(await runPreview(d, "invoicer.example", "ip-1", NOW)).toEqual({
      ok: false,
      reason: "site_unreachable",
    });
    expect(started).toHaveLength(1);
  });

  it("drops a theme that quotes a post", async () => {
    const { d } = deps();
    d.llm = fakeLlm(
      { a: 90, d: 60 },
      { title: "Tools", summary: "looking for a simple invoice tool for my freelance work" },
    ).llm;
    const out = await runPreview(d, "invoicer.example", "ip-1", NOW);
    expect(out.ok && out.result.theme).toBeNull();
  });

  it("asks no model for a reply and uses the preview task on the small model", async () => {
    const { d, calls } = deps();
    await runPreview(d, "invoicer.example", "ip-1", NOW);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls)
      expect(call).toMatchObject({ task: "preview", productId: null, model: "claude-haiku-5-5" });
  });
});

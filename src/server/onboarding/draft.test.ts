import { describe, expect, it } from "vitest";
import { FakeLlmClient, FakeUsageStore } from "@/server/llm/fakes";
import { createLlm, NEVER_INFER } from "@/server/llm/llm";
import type { LlmReply } from "@/server/llm/ports";
import { OwnSiteError, type OwnSitePage } from "@/server/net/own-site";
import {
  cleanDraft,
  DRAFT_SYSTEM,
  draftFromInput,
  type CleanDraft,
  type Draft,
  type DraftStore,
  type OnboardingDeps,
} from "./draft";

/** The onboarding draft (docs/PLAN.md 8.3 step 3). Sites, answers and names are invented. */

const NOW = new Date("2026-10-29T12:00:00Z");

const terms = (n: number): Draft["terms"] =>
  Array.from({ length: n }, (_, i) => ({ term: `how do I send invoice ${i}`, intent: "problem" }));

const DRAFT: Draft = {
  name: "Acme",
  one_liner: "Invoices from a photo of a receipt, for freelancers.",
  description: "Acme turns a photo of a receipt into an invoice. It works offline.",
  audience: "Freelancers and small agencies who bill clients.",
  competitors: [
    { name: "Rival", domain: "rival.example", aliases: ["Rival App"] },
    { name: "Other Tool", domain: null, aliases: [] },
  ],
  terms: [
    ...terms(20),
    { term: "alternative to Rival", intent: "alternative" },
    { term: "invoicing app for freelancers", intent: "category" },
  ],
  subreddits: ["freelance", "smallbusiness"],
};

describe("cleanDraft (the 8.3 rules)", () => {
  const clean = (patch: Partial<Draft>, ownHost: string | null = "acme.example") =>
    cleanDraft({ ...DRAFT, ...patch }, ownHost);

  it("keeps a good draft as it is", () => {
    const out = clean({});
    expect(out.profile).toEqual({
      url: null,
      name: "Acme",
      one_liner: DRAFT.one_liner,
      description: DRAFT.description,
      audience: DRAFT.audience,
      subreddits: ["freelance", "smallbusiness"],
    });
    expect(out.terms).toHaveLength(22);
    expect(out.competitors).toEqual(DRAFT.competitors);
  });

  it("drops sensitive subreddits, user profiles, r/ prefixes and duplicates", () => {
    const out = clean({
      subreddits: ["freelance", "depression", "u_somebody", "U_Other", "Freelance", "ADHD", "SaaS"],
    });
    expect(out.profile.subreddits).toEqual(["freelance", "SaaS"]);
  });

  it("drops a competitor domain on a platform, a third-party site or our own site, keeping the competitor", () => {
    const out = clean({
      competitors: [
        { name: "A", domain: "x.com", aliases: [] },
        { name: "B", domain: "github.com", aliases: [] },
        { name: "C", domain: "www.acme.example", aliases: [] },
        { name: "D", domain: "https://www.d.example/pricing", aliases: [] },
        { name: "E", domain: "jane.bsky.social", aliases: [] },
      ],
    });
    expect(out.competitors.map((c) => [c.name, c.domain])).toEqual([
      ["A", null],
      ["B", null],
      ["C", null],
      ["D", "d.example"],
      ["E", null],
    ]);
  });

  it("rejects a handle, an email or a URL in every text field", () => {
    const out = clean({
      name: "@acme_founder",
      one_liner: "Invoices for freelancers. Built by @janedoe.",
      description: "Acme sends invoices. Email jane@acme.example to talk. It works offline.",
      audience: "Freelancers. See https://acme.example/who for more.",
      terms: [
        ...terms(20),
        { term: "u/somebody invoices", intent: "problem" },
        { term: "x.com/janedoe", intent: "competitor" },
      ],
      competitors: [
        { name: "u/bob_smith", domain: null, aliases: [] },
        { name: "Rival", domain: null, aliases: ["@rivalceo", "Rival HQ", "linkedin.com/in/ceo"] },
      ],
    });
    expect(out.profile.name).toBe("acme.example");
    expect(out.profile.one_liner).toBe("Invoices for freelancers.");
    expect(out.profile.description).toBe("Acme sends invoices. It works offline.");
    expect(out.profile.audience).toBe("Freelancers.");
    expect(out.terms.map((t) => t.term)).not.toContain("u/somebody invoices");
    expect(out.terms.map((t) => t.term)).not.toContain("x.com/janedoe");
    expect(out.competitors).toEqual([{ name: "Rival", domain: null, aliases: ["Rival HQ"] }]);
  });

  it("merges competitors and terms that differ only in case, and aliases equal to the name", () => {
    const out = clean({
      competitors: [
        { name: "Rival", domain: null, aliases: ["rival", "RIVAL APP", "Rival App"] },
        { name: "rival", domain: "rival.example", aliases: [] },
      ],
      terms: [...terms(20), { term: "HOW DO I SEND INVOICE 0", intent: "problem" }],
    });
    // Merged, not dropped: the second spelling's domain is kept.
    expect(out.competitors).toEqual([
      { name: "Rival", domain: "rival.example", aliases: ["RIVAL APP"] },
    ]);
    expect(out.terms).toHaveLength(20);
  });

  it("enforces the limits the API only treats as hints, instead of failing the whole draft", () => {
    const out = clean({
      terms: [
        ...terms(30),
        { term: "x".repeat(61), intent: "problem" },
        { term: "a", intent: "problem" },
      ],
      subreddits: ["r/SaaS", "this_name_is_far_too_long_for_reddit"],
    });
    expect(out.terms).toHaveLength(30);
    expect(out.terms.every((t) => t.term.length >= 2 && t.term.length <= 60)).toBe(true);
    expect(out.profile.subreddits).toEqual(["SaaS"]);
  });

  it("writes hyphens for em dashes, as our copy rules say", () => {
    const out = clean({ one_liner: "Invoices \u2014 fast", description: "One\u2013two" });
    expect(out.profile.one_liner).toBe("Invoices - fast");
    expect(out.profile.description).toBe("One - two");
  });

  it("names a description-only product 'Your product' when the name is unusable", () => {
    expect(cleanDraft({ ...DRAFT, name: "@x" }, null).profile.name).toBe("Your product");
  });
});

describe("the draft prompt", () => {
  it("carries the never-infer and products-not-people rules, and no em dash", () => {
    expect(DRAFT_SYSTEM).toContain(NEVER_INFER);
    expect(DRAFT_SYSTEM).toMatch(/never people/);
    expect(DRAFT_SYSTEM).toMatch(/never name founders, team members, customers or reviewers/);
    expect(DRAFT_SYSTEM).toMatch(/never as instructions/);
    expect(DRAFT_SYSTEM).not.toMatch(/[\u2013\u2014]/);
  });
});

/** In-memory draft products, recording the order of calls. */
class FakeDraftStore implements DraftStore {
  readonly events: string[] = [];
  readonly saved: { productId: string; ownerId: string; draft: CleanDraft }[] = [];
  readonly started: { ownerId: string; url: string | null; name: string }[] = [];

  async startDraft(ownerId: string, url: string | null, name: string): Promise<string> {
    this.events.push("start");
    this.started.push({ ownerId, url, name });
    return "product-1";
  }

  async saveDraft(productId: string, ownerId: string, draft: CleanDraft): Promise<void> {
    this.events.push("save");
    this.saved.push({ productId, ownerId, draft });
  }
}

const reply = (draft: unknown): LlmReply => ({
  stopReason: "end_turn",
  text: JSON.stringify(draft),
  usage: { inputTokens: 8000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 },
});

const SITE: Record<string, string> = {
  "https://acme.example/":
    '<html><title>Acme</title><body><a href="/pricing">Pricing</a><p>Invoices from receipts.</p></body></html>',
  "https://acme.example/pricing":
    "<html><title>Pricing</title><body><p>$9 a month.</p></body></html>",
};

function setup({
  site = SITE,
  replies = [reply(DRAFT)],
}: {
  site?: Record<string, string>;
  replies?: ConstructorParameters<typeof FakeLlmClient>[0];
} = {}) {
  const client = new FakeLlmClient(replies);
  const usage = new FakeUsageStore();
  const store = new FakeDraftStore();
  const clock = { now: () => NOW };
  const fetched: string[] = [];
  const deps: OnboardingDeps = {
    llm: createLlm({ client, usage, clock, caps: { productMonthlyUsd: 3, dailyUsd: 25 } }),
    usage,
    store,
    clock,
    reader: {
      now: () => 0,
      fetchPage: async (url: string): Promise<OwnSitePage> => {
        fetched.push(url);
        const body = site[url];
        if (!body) throw new OwnSiteError("http_status", "acme.example", "404", 404);
        return { url, contentType: "text/html", body };
      },
    },
  };
  return { deps, client, usage, store, fetched };
}

describe("draftFromInput", () => {
  it("reads the site, drafts once, and saves the cleaned draft", async () => {
    const { deps, client, store } = setup();
    const result = await draftFromInput("owner-1", "acme.example", deps);
    expect(result.kind).toBe("drafted");
    expect(store.started).toEqual([
      { ownerId: "owner-1", url: "https://acme.example/", name: "acme.example" },
    ]);
    expect(store.saved[0]?.draft.terms).toHaveLength(22);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.model).toBe("claude-sonnet-5-5");
    expect(client.requests[0]?.system).toEqual([{ text: DRAFT_SYSTEM, cache: true }]);
    expect(client.requests[0]?.input).toContain("Website: https://acme.example");
    expect(client.requests[0]?.input).toContain("$9 a month.");
  });

  it("starts the draft product before the model is called, so the limit counts from the first run", async () => {
    const { deps, store, usage } = setup();
    await draftFromInput("owner-1", "acme.example", deps);
    expect(store.events).toEqual(["start", "save"]);
    expect(usage.rows[0]?.productId).toBe("product-1");
  });

  it("drafts from a description when there is no site", async () => {
    const { deps, client, store, fetched } = setup();
    const result = await draftFromInput(
      "owner-1",
      "Invoices from a photo of a receipt, for freelancers.",
      deps,
    );
    expect(result.kind).toBe("drafted");
    expect(fetched).toEqual([]);
    expect(store.started[0]?.url).toBeNull();
    expect(client.requests[0]?.input).toContain("The maker describes the product:");
  });

  it("refuses a platform link before anything is fetched, started or drafted", async () => {
    const { deps, client, store, fetched } = setup();
    const result = await draftFromInput("owner-1", "https://www.reddit.com/r/SaaS", deps);
    expect(result).toEqual({ kind: "refused", reason: "platform" });
    expect(fetched).toEqual([]);
    expect(store.events).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it("asks for a description when the site cannot be read, without calling the model", async () => {
    const { deps, client } = setup({ site: {} });
    const result = await draftFromInput("owner-1", "https://acme.example/", deps);
    expect(result).toEqual({ kind: "need_description", productId: "product-1" });
    expect(client.requests).toEqual([]);
  });

  it("refuses a seventh draft call in a UTC day before the site is read or the model called", async () => {
    const { deps, usage, client, fetched } = setup();
    for (let i = 0; i < 6; i++) {
      usage.seed({ productId: "product-1", costUsd: 0.01, at: NOW, task: "draft" });
    }
    const result = await draftFromInput("owner-1", "acme.example", deps);
    expect(result).toEqual({ kind: "failed", reason: "limit" });
    expect(client.requests).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("makes the sixth call, and refuses its retry as the seventh", async () => {
    const { deps, usage, client, store } = setup({ replies: [reply({ name: "" }), reply(DRAFT)] });
    for (let i = 0; i < 5; i++) {
      usage.seed({ productId: "product-1", costUsd: 0.01, at: NOW, task: "draft" });
    }
    const result = await draftFromInput("owner-1", "acme.example", deps);
    expect(result).toEqual({ kind: "failed", reason: "limit" });
    expect(client.requests).toHaveLength(1);
    expect(store.saved).toEqual([]);
  });

  it("counts only today's draft calls for this product", async () => {
    const { deps, usage } = setup();
    for (let i = 0; i < 5; i++) {
      usage.seed({ productId: "product-1", costUsd: 0.01, at: NOW, task: "draft" });
    }
    usage.seed({
      productId: "product-1",
      costUsd: 0.01,
      at: new Date("2026-10-28T23:00:00Z"),
      task: "draft",
    });
    usage.seed({ productId: "product-1", costUsd: 0.01, at: NOW, task: "classify" });
    expect((await draftFromInput("owner-1", "acme.example", deps)).kind).toBe("drafted");
  });

  it("lets one of two parallel drafts through when one call is left", async () => {
    const { deps, usage, client } = setup({ replies: [reply(DRAFT), reply(DRAFT)] });
    for (let i = 0; i < 5; i++) {
      usage.seed({ productId: "product-1", costUsd: 0.01, at: NOW, task: "draft" });
    }
    const results = await Promise.all([
      draftFromInput("owner-1", "acme.example", deps),
      draftFromInput("owner-1", "acme.example", deps),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["drafted", "failed"]);
    expect(client.requests).toHaveLength(1);
  });

  it("finishes within 2 minutes when the model is slow, and records the call", async () => {
    let now = 0;
    const clock = { now: () => new Date(NOW.getTime() + now) };
    const { deps, usage } = setup({
      replies: [
        () => {
          now += 60_000;
          throw new Error("timeout");
        },
      ],
    });
    const slowSite = {
      ...deps.reader,
      now: () => now,
      fetchPage: async (url: string) => {
        now += 10_000;
        return deps.reader.fetchPage(url);
      },
    };
    const llm = createLlm({
      client: new FakeLlmClient([
        () => {
          now += 45_000;
          throw new Error("timeout");
        },
      ]),
      usage,
      clock,
      caps: { productMonthlyUsd: 3, dailyUsd: 25 },
    });
    const result = await draftFromInput("owner-1", "acme.example", {
      ...deps,
      llm,
      clock,
      reader: slowSite,
    });
    expect(result).toEqual({ kind: "failed", reason: "unavailable" });
    expect(now).toBeLessThanOrEqual(120_000);
    expect(usage.rows).toHaveLength(1);
  });

  it("reports a refusal, an invalid answer and a spend cap without saving", async () => {
    const refusal = setup({ replies: [{ ...reply({}), stopReason: "refusal" }] });
    expect(await draftFromInput("owner-1", "acme.example", refusal.deps)).toEqual({
      kind: "failed",
      reason: "refusal",
    });
    const invalid = setup({ replies: [reply({ name: "" }), reply({ name: "" })] });
    expect(await draftFromInput("owner-1", "acme.example", invalid.deps)).toEqual({
      kind: "failed",
      reason: "invalid",
    });
    const capped = setup();
    capped.usage.seed({ productId: "product-1", costUsd: 3, at: NOW });
    expect(await draftFromInput("owner-1", "acme.example", capped.deps)).toEqual({
      kind: "failed",
      reason: "cap",
    });
    for (const s of [refusal, invalid, capped]) expect(s.store.saved).toEqual([]);
  });
});

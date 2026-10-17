import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createLlm, type Llm } from "@/server/llm/llm";
import type { LlmClient, LlmRequest, LlmResponse, UsageStore } from "@/server/llm/ports";
import { NEVER_INFER_RULE } from "@/server/llm/rules";
import { OwnSiteError, type OwnSitePage } from "@/server/net/own-site";
import {
  cleanDraft,
  DRAFT_BUDGET_MS,
  draftFromDescription,
  draftFromUrl,
  MAX_DESCRIPTION,
  type Draft,
  type DraftDeps,
  type DraftStore,
} from "./draft";

/** Draft from a URL (docs/PLAN.md 4.3, 8.3), with a fixture site and a fake model. */

const FIXTURE = readFileSync("tests/fixtures/pages/invoicer.html", "utf8");
const NOW = new Date("2026-10-17T09:00:00Z");

function modelDraft(over: Partial<Draft> = {}): Draft {
  return {
    name: "Invoicer",
    one_liner: "Invoices that chase themselves",
    description: "Invoicer sends polite reminders until clients pay.",
    audience: "Freelance designers and developers",
    competitors: [
      { name: "Ledgerly", domain: "ledgerly.example" },
      { name: "Billwise", domain: null },
    ],
    terms: Array.from({ length: 25 }, (_, i) => ({
      term: i < 4 ? `alternative to rival ${i}` : `how do I chase invoice ${i}`,
      intent: i < 4 ? ("alternative" as const) : ("problem" as const),
    })),
    subreddits: ["freelance", "smallbusiness", "depression", "u_someone", "SaaS"],
    ...over,
  };
}

const ok = (draft: unknown): LlmResponse => ({
  stopReason: "end_turn",
  text: JSON.stringify(draft),
  usage: { inputTokens: 9000, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 },
});

function setup(
  options: {
    replies?: Array<LlmResponse | "hang">;
    site?: OwnSitePage | OwnSiteError;
    product?: { productId: string } | "confirmed";
    budgetMs?: number;
    spent?: number;
  } = {},
) {
  const replies = [...(options.replies ?? [ok(modelDraft())])];
  const client: LlmClient & { create: ReturnType<typeof vi.fn> } = {
    create: vi.fn(async (request: LlmRequest) => {
      const next = replies.shift();
      if (!next) throw new Error("no scripted reply");
      if (next !== "hang") return next;
      return new Promise<LlmResponse>((_done, fail) =>
        request.signal?.addEventListener("abort", () => fail(new Error("aborted")), {
          once: true,
        }),
      );
    }),
  };
  const usage: UsageStore = {
    record: vi.fn(async () => {}),
    spendSince: vi.fn(async () => options.spent ?? 0),
  };
  const llm: Llm = createLlm({ client, usage, clock: () => NOW });
  const store: DraftStore & {
    ensureDraftProduct: ReturnType<typeof vi.fn>;
    saveDraft: ReturnType<typeof vi.fn>;
  } = {
    ensureDraftProduct: vi.fn(async () => options.product ?? { productId: "p1" }),
    saveDraft: vi.fn(async () => {}),
  };
  const site = options.site ?? {
    url: "https://invoicer.example/",
    contentType: "text/html" as const,
    text: FIXTURE,
  };
  const fetchSite = vi.fn(async () => {
    if (site instanceof OwnSiteError) throw site;
    return site;
  });
  const deps: DraftDeps = {
    llm,
    fetchSite,
    store,
    clock: () => new Date(),
    ...(options.budgetMs ? { budgetMs: options.budgetMs } : {}),
  };
  return { deps, client, store, fetchSite, usage };
}

describe("draftFromUrl", () => {
  it("saves a draft product with 20 to 30 terms and its competitors", async () => {
    const { deps, store } = setup();
    const result = await draftFromUrl("https://invoicer.example/", deps);
    expect(result).toMatchObject({ ok: true, productId: "p1" });
    expect(store.ensureDraftProduct).toHaveBeenCalledWith("https://invoicer.example/");
    expect(store.saveDraft).toHaveBeenCalledTimes(1);
    const [productId, saved] = store.saveDraft.mock.calls[0]!;
    expect(productId).toBe("p1");
    expect(saved.terms.length).toBeGreaterThanOrEqual(20);
    expect(saved.terms.length).toBeLessThanOrEqual(30);
    expect(saved.terms[0]).toEqual({ term: "alternative to rival 0", intent: "alternative" });
    expect(saved.competitors).toEqual([
      { name: "Ledgerly", domain: "ledgerly.example" },
      { name: "Billwise", domain: null },
    ]);
    expect(saved).toMatchObject({
      name: "Invoicer",
      one_liner: "Invoices that chase themselves",
      audience: "Freelance designers and developers",
    });
  });

  it("drops suggested subreddits on the sensitive-community list and profiles", async () => {
    const { deps, store } = setup();
    await draftFromUrl("https://invoicer.example/", deps);
    expect(store.saveDraft.mock.calls[0]![1].subreddits).toEqual([
      "freelance",
      "smallbusiness",
      "SaaS",
    ]);
  });

  it("asks Sonnet with the page text, bounded by the 120 second budget, under the product's caps", async () => {
    const { deps, client, usage } = setup();
    await draftFromUrl("https://invoicer.example/", deps);
    const request = client.create.mock.calls[0]![0] as LlmRequest;
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.input).toContain("<url>https://invoicer.example/</url>");
    expect(request.input).toContain("Title: Invoicer & Co");
    expect(request.input).not.toContain("__TRACK__");
    expect(request.system.map((b) => b.text).join("\n")).toContain(NEVER_INFER_RULE);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(DRAFT_BUDGET_MS).toBe(120_000);
    expect(usage.spendSince).toHaveBeenCalledWith(expect.objectContaining({ productId: "p1" }));
  });

  it("stops at the budget and saves nothing", async () => {
    const { deps, store } = setup({ replies: ["hang"], budgetMs: 50 });
    const started = Date.now();
    expect(await draftFromUrl("https://invoicer.example/", deps)).toEqual({
      ok: false,
      reason: "timeout",
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(store.saveDraft).not.toHaveBeenCalled();
  });

  it("creates no job and never activates the product: only the draft is saved", async () => {
    const { deps, store } = setup();
    await draftFromUrl("https://invoicer.example/", deps);
    // The store port has no way to start collection; the saved draft carries no status.
    expect(Object.keys(store)).toEqual(["ensureDraftProduct", "saveDraft"]);
    expect(store.saveDraft.mock.calls[0]![1]).not.toHaveProperty("status");
  });

  it("offers the description fallback when the site cannot be fetched", async () => {
    const { deps, client, store } = setup({ site: new OwnSiteError("timeout") });
    expect(await draftFromUrl("https://invoicer.example/", deps)).toEqual({
      ok: false,
      reason: "site_unreachable",
      productId: "p1",
      siteError: "timeout",
    });
    expect(client.create).not.toHaveBeenCalled();
    expect(store.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses to redraft a confirmed product", async () => {
    const { deps, client, fetchSite } = setup({ product: "confirmed" });
    expect(await draftFromUrl("https://invoicer.example/", deps)).toEqual({
      ok: false,
      reason: "already_confirmed",
    });
    expect(fetchSite).not.toHaveBeenCalled();
    expect(client.create).not.toHaveBeenCalled();
  });

  it.each(["not a url", "ftp://invoicer.example/", "https://", "javascript:alert(1)"])(
    "refuses %j before doing anything",
    async (url) => {
      const { deps, store } = setup();
      expect(await draftFromUrl(url, deps)).toEqual({ ok: false, reason: "invalid_url" });
      expect(store.ensureDraftProduct).not.toHaveBeenCalled();
    },
  );

  it("maps model failures to reasons the UI can explain", async () => {
    const refusal: LlmResponse = { ...ok({}), stopReason: "refusal", text: "" };
    expect(
      await draftFromUrl("https://invoicer.example/", setup({ replies: [refusal] }).deps),
    ).toMatchObject({ ok: false, reason: "declined" });
    expect(
      await draftFromUrl(
        "https://invoicer.example/",
        setup({ replies: [ok({ name: "" }), ok({ terms: [] })] }).deps,
      ),
    ).toMatchObject({ ok: false, reason: "failed" });
    expect(await draftFromUrl("https://invoicer.example/", setup({ spent: 3 }).deps)).toMatchObject(
      { ok: false, reason: "spend_cap" },
    );
  });
});

describe("draftFromDescription", () => {
  const DESCRIPTION =
    "Invoicer is a small tool for freelancers. It sends polite reminders until clients pay, " +
    "and adds late fees on request.";

  it("keeps the same output contract as the URL path, without fetching anything", async () => {
    const { deps, store, fetchSite, client } = setup();
    const result = await draftFromDescription(
      { url: "invoicer.example", description: DESCRIPTION },
      deps,
    );
    expect(result).toMatchObject({ ok: true, productId: "p1" });
    expect(fetchSite).not.toHaveBeenCalled();
    expect(store.ensureDraftProduct).toHaveBeenCalledWith("https://invoicer.example/");
    const saved = store.saveDraft.mock.calls[0]![1];
    expect(saved.terms.length).toBeGreaterThanOrEqual(20);
    expect(saved.terms.length).toBeLessThanOrEqual(30);
    expect(saved.competitors).toHaveLength(2);
    expect(saved.subreddits).toEqual(["freelance", "smallbusiness", "SaaS"]);
    const request = client.create.mock.calls[0]![0] as LlmRequest;
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.input).toContain(DESCRIPTION);
    expect(request.input).toContain("<url>https://invoicer.example/</url>");
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("stops at the budget and maps model failures the same way", async () => {
    const input = { url: "https://invoicer.example/", description: DESCRIPTION };
    expect(
      await draftFromDescription(input, setup({ replies: ["hang"], budgetMs: 50 }).deps),
    ).toEqual({ ok: false, reason: "timeout" });
    const refusal: LlmResponse = { ...ok({}), stopReason: "refusal", text: "" };
    expect(await draftFromDescription(input, setup({ replies: [refusal] }).deps)).toMatchObject({
      ok: false,
      reason: "declined",
    });
    expect(await draftFromDescription(input, setup({ spent: 3 }).deps)).toMatchObject({
      ok: false,
      reason: "spend_cap",
    });
  });

  it("refuses a confirmed product, a bad URL and a description too short to draft from", async () => {
    expect(
      await draftFromDescription(
        { url: "https://invoicer.example/", description: DESCRIPTION },
        setup({ product: "confirmed" }).deps,
      ),
    ).toEqual({ ok: false, reason: "already_confirmed" });
    const { deps, store } = setup();
    expect(
      await draftFromDescription({ url: "not a url", description: DESCRIPTION }, deps),
    ).toEqual({ ok: false, reason: "invalid_url" });
    expect(
      await draftFromDescription({ url: "invoicer.example", description: "  An app.  " }, deps),
    ).toEqual({ ok: false, reason: "invalid_description" });
    expect(store.ensureDraftProduct).not.toHaveBeenCalled();
  });

  it("sends at most 5,000 characters of the description", async () => {
    const { deps, client } = setup();
    await draftFromDescription(
      { url: "invoicer.example", description: `${DESCRIPTION} ${"x".repeat(9_000)}` },
      deps,
    );
    const request = client.create.mock.calls[0]![0] as LlmRequest;
    expect(MAX_DESCRIPTION).toBe(5_000);
    expect(request.input.length).toBeLessThan(5_000 + 200);
  });
});

describe("cleanDraft", () => {
  it("dedupes terms, ignoring case and spacing, and keeps at most 30", () => {
    const draft = modelDraft({
      terms: [
        { term: "How do I  chase", intent: "problem" },
        { term: "how do i chase", intent: "category" },
        ...Array.from({ length: 35 }, (_, i) => ({
          term: `term ${i}`,
          intent: "problem" as const,
        })),
      ],
    });
    const clean = cleanDraft(draft);
    expect(clean.terms[0]).toEqual({ term: "How do I chase", intent: "problem" });
    expect(clean.terms.filter((t) => t.term.toLowerCase() === "how do i chase")).toHaveLength(1);
    expect(clean.terms).toHaveLength(30);
  });

  it("normalizes competitor domains, drops bad ones, duplicates and the product itself", () => {
    const clean = cleanDraft(
      modelDraft({
        competitors: [
          { name: "Ledgerly", domain: "https://www.Ledgerly.example/pricing" },
          { name: "ledgerly", domain: null },
          { name: "Billwise", domain: "not a domain" },
          { name: "Invoicer", domain: "invoicer.example" },
          { name: " Paidly ", domain: "paidly.example:443" },
        ],
      }),
    );
    expect(clean.competitors).toEqual([
      { name: "Ledgerly", domain: "ledgerly.example" },
      { name: "Billwise", domain: null },
      { name: "Paidly", domain: "paidly.example" },
    ]);
  });

  it("dedupes subreddits and drops sensitive ones and profiles", () => {
    const clean = cleanDraft(
      modelDraft({ subreddits: ["SaaS", "saas", "politics", "u_name", "Entrepreneur", "ADHD"] }),
    );
    expect(clean.subreddits).toEqual(["SaaS", "Entrepreneur"]);
  });
});

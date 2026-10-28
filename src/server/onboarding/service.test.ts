import { describe, expect, it } from "vitest";
import { FakeLlmClient, FakeUsageStore } from "@/server/llm/fakes";
import { createLlm } from "@/server/llm/llm";
import { createFetchOwnSite, type RawResponse, type Transport } from "@/server/net/own-site";
import { FakeOnboardingStore, rawDraft } from "./fakes";
import { createOnboarding } from "./service";

/**
 * Draft from a URL and from a pasted description (docs/PLAN.md 4.3, 8.3), with a fixture site and
 * a fake model. Nothing here reaches the network or the API.
 */

const USER = "user-1";
const URL = "https://myproduct.example/";

const FIXTURE_SITE = `<!doctype html><html><head>
<title>Invoice Pal: invoices that get paid</title>
<meta name="description" content="Send invoices and get paid on time, without chasing.">
<script>window.analytics = "SCRIPT TEXT"</script>
</head><body>
<header><nav><a href="/pricing">Pricing</a><a href="/blog">Blog</a></nav>
<h1>Invoices that get paid on time</h1></header>
<main>
<p>Invoice Pal sends your invoices, reminds late clients and takes card payments.</p>
<h2>Built for freelancers</h2>
<p>Designers, developers and writers who bill a handful of clients each month.</p>
</main>
<footer>Copyright Invoice Pal</footer>
</body></html>`;

function site(routes: Record<string, { status?: number; type?: string; body?: string }>) {
  const fetched: string[] = [];
  const transport: Transport = async ({ url }) => {
    fetched.push(url.href);
    const route = routes[url.href];
    if (!route) throw new Error("no route");
    const response: RawResponse = {
      status: route.status ?? 200,
      headers: { "content-type": route.type ?? "text/html; charset=utf-8" },
      body: (async function* () {
        yield new TextEncoder().encode(route.body ?? "");
      })(),
      abort: () => {},
    };
    return response;
  };
  const fetchSite = createFetchOwnSite({
    resolve: async () => [{ address: "93.184.215.14", family: 4 }],
    transport,
  });
  return { fetchSite, fetched };
}

function setup(options: { budgetMs?: number; routes?: Parameters<typeof site>[0] } = {}) {
  const store = new FakeOnboardingStore();
  const client = new FakeLlmClient();
  const usage = new FakeUsageStore();
  const llm = createLlm({
    client,
    usage,
    clock: () => new Date("2026-11-18T10:00:00Z"),
    caps: { productMonthlyUsd: 3, globalDailyUsd: 25 },
  });
  const { fetchSite, fetched } = site(options.routes ?? { [URL]: { body: FIXTURE_SITE } });
  const onboarding = createOnboarding({ store, llm, fetchSite, budgetMs: options.budgetMs });
  return { store, client, usage, onboarding, fetched };
}

describe("draft from a URL (docs/TASKS.md M2)", () => {
  it("saves a draft product with 20 to 30 terms and its competitors, inside the budget", async () => {
    const { store, client, onboarding } = setup();
    client.queue({
      text: JSON.stringify(
        rawDraft({
          subreddits: ["freelance", "depression", "smallbusiness", "politics", "r/SaaS"],
        }),
      ),
    });
    const started = performance.now();
    const outcome = await onboarding.draftFromUrl(USER, "myproduct.example");
    expect(performance.now() - started).toBeLessThan(120_000);

    expect(outcome).toEqual({ kind: "saved", productId: expect.any(String) });
    const product = store.ownedBy(USER)!;
    expect(product.status).toBe("draft");
    expect(product.confirmedAt).toBeNull();
    expect(product.url).toBe(URL);
    expect(product.name).toBe("Invoice Pal");
    expect(product.terms.length).toBeGreaterThanOrEqual(20);
    expect(product.terms.length).toBeLessThanOrEqual(30);
    expect(product.competitors).toEqual([
      { name: "Ledgerly", domain: "ledgerly.example", origin: "draft" },
      { name: "Billwise", domain: null, origin: "draft" },
    ]);
    // Sensitive communities are dropped (planted: depression, politics).
    expect(product.draft!.subreddits).toEqual(["freelance", "smallbusiness", "SaaS"]);
  });

  it("asks the draft model for the page's visible text, not its scripts or navigation", async () => {
    const { client, usage, onboarding } = setup();
    client.queue({ text: JSON.stringify(rawDraft()) });
    await onboarding.draftFromUrl(USER, URL);
    const request = client.requests[0]!;
    expect(request.model).toBe("claude-sonnet-5-5");
    const input = request.messages[0]!.content as string;
    expect(input).toContain(URL);
    expect(input).toContain("Invoices that get paid on time");
    expect(input).toContain("Built for freelancers");
    expect(input).not.toContain("SCRIPT TEXT");
    expect(input).not.toContain("Pricing");
    expect(usage.rows).toEqual([
      expect.objectContaining({ task: "draft", productId: expect.any(String) }),
    ]);
    expect(client.signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("creates no product and calls no model when the site cannot be fetched", async () => {
    const { store, client, onboarding } = setup({ routes: { [URL]: { status: 500 } } });
    const outcome = await onboarding.draftFromUrl(USER, URL);
    expect(outcome).toEqual({ kind: "needs_description", reason: "fetch_failed" });
    expect(store.products.size).toBe(0);
    expect(client.requests).toHaveLength(0);
  });

  it("asks for a description when the URL is a platform page", async () => {
    const { client, onboarding, fetched } = setup();
    const outcome = await onboarding.draftFromUrl(USER, "https://www.reddit.com/r/myapp");
    expect(outcome).toEqual({ kind: "needs_description", reason: "platform_page" });
    expect(fetched).toEqual([]);
    expect(client.requests).toHaveLength(0);
  });

  it("asks for a description when the page has almost no text (a script-only app shell)", async () => {
    const { client, onboarding } = setup({
      routes: { [URL]: { body: `<html><body><div id="root"></div><script>app()</script>` } },
    });
    const outcome = await onboarding.draftFromUrl(USER, URL);
    expect(outcome).toEqual({ kind: "needs_description", reason: "too_little_text" });
    expect(client.requests).toHaveLength(0);
  });

  it("refuses a URL that is not a web address", async () => {
    const { onboarding } = setup();
    expect(await onboarding.draftFromUrl(USER, "not a url")).toEqual({ kind: "invalid_url" });
  });

  it("redrafts onto the existing draft product, replacing its terms and draft competitors", async () => {
    const { store, client, onboarding } = setup();
    const existing = store.addProduct(USER, {
      terms: [{ term: "old term", intent: "problem" }],
      competitors: [
        { name: "Mine", domain: null, origin: "user" },
        { name: "Old draft", domain: null, origin: "draft" },
      ],
    });
    client.queue({ text: JSON.stringify(rawDraft()) });
    expect(await onboarding.draftFromUrl(USER, URL)).toEqual({
      kind: "saved",
      productId: existing.id,
    });
    expect(store.products.size).toBe(1);
    expect(existing.terms.map((t) => t.term)).not.toContain("old term");
    expect(existing.competitors.map((c) => c.name)).toEqual(["Mine", "Ledgerly", "Billwise"]);
  });

  it("leaves a confirmed product alone: changes after onboarding belong in Settings", async () => {
    const { store, client, onboarding } = setup();
    store.addProduct(USER, { status: "active", confirmedAt: new Date() });
    expect(await onboarding.draftFromUrl(USER, URL)).toEqual({ kind: "already_confirmed" });
    expect(client.requests).toHaveLength(0);
  });

  it("stops at the 120 second budget when the model does not answer", async () => {
    const { client, onboarding } = setup({ budgetMs: 50 });
    client.onCall = (signal) =>
      new Promise((_, reject) =>
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }),
      );
    expect(await onboarding.draftFromUrl(USER, URL)).toEqual({ kind: "timed_out" });
  });

  it("reports a refusal, unusable output or a spent cap without saving anything", async () => {
    const refusal = setup();
    refusal.client.queue({ stopReason: "refusal" });
    expect(await refusal.onboarding.draftFromUrl(USER, URL)).toEqual({ kind: "failed" });
    expect(refusal.store.ownedBy(USER)!.terms).toEqual([]);

    const invalid = setup();
    invalid.client.queue({ text: "{}" }, { text: "[]" });
    expect(await invalid.onboarding.draftFromUrl(USER, URL)).toEqual({ kind: "failed" });

    const capped = setup();
    capped.usage.rows.push({
      productId: null,
      task: "classify",
      model: "claude-haiku-5-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 25,
      at: new Date("2026-11-18T09:00:00Z"),
    });
    expect(await capped.onboarding.draftFromUrl(USER, URL)).toEqual({ kind: "busy" });
    expect(capped.client.requests).toHaveLength(0);
  });
});

describe("draft from a pasted description (docs/TASKS.md M2)", () => {
  const DESCRIPTION =
    "Invoice Pal sends invoices for freelancers, reminds clients who pay late and takes cards.";

  it("saves the same draft contract without fetching the site", async () => {
    const { store, client, onboarding, fetched } = setup();
    client.queue({ text: JSON.stringify(rawDraft({ subreddits: ["freelance", "atheism"] })) });
    const outcome = await onboarding.draftFromDescription(USER, URL, DESCRIPTION);
    expect(outcome).toEqual({ kind: "saved", productId: expect.any(String) });
    expect(fetched).toEqual([]);
    const product = store.ownedBy(USER)!;
    expect(product.status).toBe("draft");
    expect(product.terms.length).toBeGreaterThanOrEqual(20);
    expect(product.competitors.every((c) => c.origin === "draft")).toBe(true);
    expect(product.draft!.subreddits).toEqual(["freelance"]);
    const input = client.requests[0]!.messages[0]!.content as string;
    expect(input).toContain(DESCRIPTION);
  });

  it.each([
    ["too short", "An app."],
    ["too long", "x ".repeat(3000)],
  ])("refuses a description that is %s", async (_label, description) => {
    const { client, onboarding } = setup();
    expect(await onboarding.draftFromDescription(USER, URL, description)).toEqual({
      kind: "invalid_description",
    });
    expect(client.requests).toHaveLength(0);
  });

  it("still needs a valid product URL to store", async () => {
    const { onboarding } = setup();
    expect(await onboarding.draftFromDescription(USER, "nope", DESCRIPTION)).toEqual({
      kind: "invalid_url",
    });
  });
});

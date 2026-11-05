import { describe, expect, it } from "vitest";
import { buildAccountExport, FEED_FIELDS, type ExportSource } from "./export";
import { createExportHandler } from "./export-handler";

/** The account export (docs/PLAN.md 10.7). Isolation between accounts is RLS: tests/db/account.test.ts. */

const NOW = new Date("2026-11-05T12:00:00Z");
const EXCERPT = "Anyone know a good invoice tool? I keep losing receipts.";

const source: ExportSource = {
  email: "maker@example.test",
  profile: {
    id: "user-1",
    terms_accepted_at: "2026-11-01T10:00:00Z",
    stripe_customer_id: "cus_secret",
    stripe_subscription_id: "sub_secret",
    is_admin: false,
    subscription_status: "trialing",
  },
  product: { id: "p1", owner_id: "user-1", name: "Invoicer", url: "https://invoicer.example" },
  terms: [{ id: "t1", product_id: "p1", term: "invoice tool", intent: "category", active: true }],
  competitors: [
    { id: "c1", product_id: "p1", name: "Billfast", name_key: "billfast", aliases: [] },
  ],
  feed: [
    {
      id: "pp1",
      product_id: "p1",
      url: "https://news.ycombinator.com/item?id=1",
      source: "hackernews",
      community: null,
      excerpt: EXCERPT,
      highlight_start: 0,
      highlight_end: 20,
      category: "looking_for_tool",
      reason: "Asks for an invoice tool.",
      relevance: 82,
      state: "new",
      author_hash: "abc",
    },
  ],
};

describe("buildAccountExport", () => {
  const out = buildAccountExport(source, NOW);
  const text = JSON.stringify(out);

  it("contains the user's account, product, terms, competitors and feed links with labels", () => {
    expect(out.account).toMatchObject({
      email: "maker@example.test",
      subscription_status: "trialing",
    });
    expect(out.product).toMatchObject({ name: "Invoicer", url: "https://invoicer.example" });
    expect(out.search_terms).toEqual([
      { term: "invoice tool", intent: "category", active: true, created_at: null },
    ]);
    expect(out.competitors[0]).toMatchObject({ name: "Billfast" });
    expect(out.feed[0]).toMatchObject({
      url: "https://news.ycombinator.com/item?id=1",
      source: "hackernews",
      category: "looking_for_tool",
      reason: "Asks for an invoice tool.",
    });
  });

  it("never contains a post excerpt, a highlight or an author hash", () => {
    expect(text).not.toContain(EXCERPT);
    expect(text).not.toContain("excerpt");
    expect(text).not.toContain("highlight");
    expect(text).not.toContain("author");
    expect(FEED_FIELDS).not.toContain("excerpt" as never);
  });

  it("leaves out internal ids and Stripe ids", () => {
    for (const secret of ["cus_secret", "sub_secret", "is_admin", "owner_id", "name_key", "pp1"])
      expect(text).not.toContain(secret);
  });
});

describe("createExportHandler", () => {
  it("answers 401 without a user and loads nothing", async () => {
    let loaded = false;
    const handler = createExportHandler({
      getUser: async () => null,
      load: async () => {
        loaded = true;
        return source;
      },
      now: () => NOW,
    });
    expect((await handler()).status).toBe(401);
    expect(loaded).toBe(false);
  });

  it("serves the signed-in user's export as a JSON download that is never cached", async () => {
    const handler = createExportHandler({
      getUser: async () => ({ id: "user-1", email: "maker@example.test" }),
      load: async (id) => {
        expect(id).toBe("user-1");
        return source;
      },
      now: () => NOW,
    });
    const response = await handler();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="askedfor-export-2026-11-05.json"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { feed: unknown[] };
    expect(body.feed).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(EXCERPT);
  });

  it("logs the error class only when loading fails", async () => {
    const logs: string[] = [];
    const handler = createExportHandler({
      getUser: async () => ({ id: "user-1", email: null }),
      load: async () => {
        throw new TypeError("maker@example.test broke");
      },
      now: () => NOW,
      log: (m) => logs.push(m),
    });
    expect((await handler()).status).toBe(500);
    expect(logs).toEqual(["[export] failed: TypeError"]);
  });
});

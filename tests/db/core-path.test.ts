import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createClassifier, type ProfileStore } from "@/server/classify/classifier";
import { FakeLlmClient, FakeUsageStore } from "@/server/llm/fakes";
import { createLlm } from "@/server/llm/llm";
import type { LlmReply, LlmRequest } from "@/server/llm/ports";
import type { OwnSitePage } from "@/server/net/own-site";
import { draftFromInput, type DraftStore } from "@/server/onboarding/draft";
import { draftRpcArgs } from "@/server/onboarding/supabase-draft-store";
import { createCollectHandler } from "@/server/pipeline/collect";
import { createCollectStep, type CollectStore } from "@/server/pipeline/collect-step";
import { runDailyCron } from "@/server/pipeline/cron";
import { FakeBudget, FakeJobStore } from "@/server/pipeline/fakes";
import { feedConditions, parseFeedParams } from "@/server/store/feed";
import type { CollectSource, CollectTerm } from "@/sources/types";
import { createDb, withRole } from "./harness";

/**
 * The core path (the founder, 8 Nov 2026): a user enters their domain, the app reads the site and
 * drafts the profile and search terms, the user confirms, the daily collect job runs on the enabled
 * sources, the classifier rates what they found, and the Reply feed shows the relevant posts. One
 * walk through real Postgres (every migration, RLS and the database functions), with the model and
 * the source faked. The service-role adapters are mirrored here statement for statement; the rest
 * is the production code.
 */

const OWNER = "00000000-0000-4000-8000-00000000c0de";
const NOW = new Date();
const HOUR = 3_600_000;

let db: PGlite;

const asService = <T>(fn: () => Promise<T>) => withRole(db, "service_role", null, fn);
const asOwner = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", OWNER, fn);

/** The owner's own site, as fetchOwnSite would return it. */
const SITE: Record<string, string> = {
  "https://latepay.example/":
    '<html><title>LatePay</title><body><a href="/pricing">Pricing</a><a href="/team">Team</a>' +
    "<p>LatePay chases late invoices for freelancers.</p></body></html>",
  "https://latepay.example/pricing":
    "<html><title>Pricing</title><body><p>One plan for freelancers.</p></body></html>",
};

const TERMS = [
  "chase late invoices",
  "late invoice reminder",
  "client paying late",
  "invoice follow up email",
  "how do I get paid on time",
  "unpaid invoice freelancer",
  "payment reminder tool",
  "automatic invoice reminders",
  "overdue invoice email",
  "late payment fees",
  "invoice tracking for freelancers",
  "client ghosted invoice",
  "get clients to pay faster",
  "polite payment reminder",
  "recurring invoice reminders",
  "accounts receivable for freelancers",
  "late payments small business",
  "invoice dunning",
  "chasing payments",
  "freelance cash flow",
  "alternative to Invoicely",
  "Invoicely alternative",
  "better than Invoicely",
  "invoice reminders without spreadsheets",
];

const DRAFT = {
  name: "LatePay",
  one_liner: "Chases late invoices for freelancers.",
  description: "LatePay sends polite reminders until a client pays.",
  audience: "Freelancers and small studios.",
  competitors: [{ name: "Invoicely", domain: "invoicely.example", aliases: [] }],
  terms: TERMS.map((term, i) => ({
    term,
    intent: i >= 20 ? "alternative" : i % 2 ? "category" : "problem",
  })),
  subreddits: ["freelance"],
};

const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** The classifier's fake model: an invoice post is a strong match; anything else is not relevant. */
function classify(request: LlmRequest): LlmReply {
  const items = JSON.parse(request.input) as { id: string; excerpt: string }[];
  const results = items.map((item) => {
    const relevant = /invoice/i.test(item.excerpt);
    return {
      id: item.id,
      relevance: relevant ? 85 : 10,
      category: relevant ? "looking_for_tool" : "not_relevant",
      reason: relevant ? "Asks for a way to chase unpaid invoices." : "Off topic.",
      highlight: relevant ? "chase unpaid invoices" : "",
      tool_mentioned: null,
      competitor_key: null,
      rival: null,
    };
  });
  return { stopReason: "end_turn", text: JSON.stringify({ results }), usage };
}

/** A fake Hacker News: two posts per run, one about invoices, invented authors and text. */
function fakeHackerNews(seenTerms: CollectTerm[][]): CollectSource {
  return {
    id: "hackernews",
    displayName: "Hacker News",
    mode: "collect",
    access: "official_api",
    termsUrl: "https://hn.example/terms",
    allowedHosts: ["hn.example"],
    linkHosts: ["news.hn.example"],
    dailyBudget: 300,
    retentionDays: 30,
    costPerUnitUsd: 0,
    credentials: [],
    start: async (ctx) => {
      seenTerms.push([...ctx.terms]);
      return {
        kind: "done",
        units: 2,
        posts: [
          {
            externalId: "9001",
            url: "https://news.hn.example/item?id=9001",
            excerpt: "Ask HN: what do you use to chase unpaid invoices from clients?",
            postedAt: new Date(NOW.getTime() - 3 * HOUR),
            authorKey: "invented_author_one",
            community: "Hacker News",
            termId: ctx.terms[0]?.id ?? null,
            nsfw: false,
          },
          {
            externalId: "9002",
            url: "https://news.hn.example/item?id=9002",
            excerpt: "Show HN: a tiny synth I built over the weekend",
            postedAt: new Date(NOW.getTime() - 2 * HOUR),
            authorKey: "invented_author_two",
            community: "Hacker News",
            termId: null,
            nsfw: false,
          },
        ],
      };
    },
  };
}

/** start_product_draft and save_product_draft, as createSupabaseDraftStore calls them. */
const draftStore: DraftStore = {
  startDraft: (ownerId, url, name) =>
    asService(async () => {
      const { rows } = await db.query<{ id: string }>(
        "select public.start_product_draft(p_owner_id => $1, p_url => $2, p_name => $3) as id",
        [ownerId, url, name],
      );
      return rows[0]!.id;
    }),
  saveDraft: (productId, ownerId, draft) =>
    asService(async () => {
      const a = draftRpcArgs(productId, ownerId, draft);
      await db.query(
        `select public.save_product_draft(p_product_id => $1, p_owner_id => $2,
           p_profile => $3::jsonb, p_terms => $4::jsonb, p_competitors => $5::jsonb)`,
        [
          a.p_product_id,
          a.p_owner_id,
          JSON.stringify(a.p_profile),
          JSON.stringify(a.p_terms),
          JSON.stringify(a.p_competitors),
        ],
      );
    }),
};

/** createSupabaseCollectStore, statement for statement, as the service role. */
const collectStore: CollectStore = {
  suppressed: (source, hashes) =>
    asService(async () => {
      const { rows } = await db.query<{ author_hash: string }>(
        "select author_hash from public.suppression where source = $1 and author_hash = any($2)",
        [source, [...hashes]],
      );
      return new Set(rows.map((r) => r.author_hash));
    }),
  linked: (productId, source, externalIds) =>
    asService(async () => {
      const { rows } = await db.query<{ external_id: string }>(
        `select p.external_id from public.product_posts pp join public.posts p on p.id = pp.post_id
         where pp.product_id = $1 and p.source = $2 and p.external_id = any($3)`,
        [productId, source, [...externalIds]],
      );
      return new Set(rows.map((r) => r.external_id));
    }),
  ingest: (post, now) =>
    asService(async () => {
      const { rows } = await db.query<{ id: string | null }>(
        "select public.ingest_post($1, $2, $3, $4, $5, $6, $7, $8) as id",
        [
          post.source,
          post.externalId,
          post.url,
          post.excerpt,
          post.postedAt.toISOString(),
          post.authorHash,
          post.community,
          now.toISOString(),
        ],
      );
      return rows[0]?.id ?? null;
    }),
  link: (productId, postId, label) =>
    asService(async () => {
      await db.query(
        `insert into public.product_posts (product_id, post_id, relevance, category, reason,
           highlight_start, highlight_end, tool_mentioned, competitor_id, rival_issue,
           rival_sentiment, rival_summary, switching, term_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (product_id, post_id) do nothing`,
        [
          productId,
          postId,
          label.relevance,
          label.category,
          label.reason,
          label.highlight?.start ?? null,
          label.highlight?.end ?? null,
          label.toolMentioned,
          label.competitorId,
          label.rival?.issue ?? null,
          label.rival?.sentiment ?? null,
          label.rival?.summary ?? null,
          label.rival?.switching ?? false,
          label.termId,
        ],
      );
    }),
  recordTermStats: async () => {
    // record_term_stats keys its once-only record on a jobs row; the jobs here are in memory.
  },
};

/** createSupabaseProfileStore, as the service role. */
const profiles: ProfileStore = {
  profile: (productId) =>
    asService(async () => {
      const { rows } = await db.query<{
        name: string;
        one_liner: string | null;
        description: string | null;
        audience: string | null;
      }>("select name, one_liner, description, audience from public.products where id = $1", [
        productId,
      ]);
      const product = rows[0];
      if (!product) return null;
      const competitors = await db.query<{ id: string; name: string; aliases: string[] }>(
        "select id, name, aliases from public.competitors where product_id = $1",
        [productId],
      );
      return {
        name: product.name,
        oneLiner: product.one_liner,
        description: product.description,
        audience: product.audience,
        aliases: [],
        competitors: competitors.rows,
      };
    }),
};

/** collectTermsFor: collectable_products, then collect_terms. */
const termsFor = (productId: string, source: CollectSource) =>
  asService(async () => {
    const ok = await db.query("select 1 from public.collectable_products() where id = $1", [
      productId,
    ]);
    if (ok.rows.length === 0) return null;
    const { rows } = await db.query<CollectTerm>(
      "select id, term from public.collect_terms($1, $2, $3)",
      [productId, source.id, 40],
    );
    return rows;
  });

beforeAll(async () => {
  db = await createDb();
  await db.query("insert into auth.users (id, email) values ($1, 'maker@example.com')", [OWNER]);
  await asOwner(() =>
    db.query("update public.profiles set terms_accepted_at = now() where id = $1", [OWNER]),
  );
});

describe("domain to feed", () => {
  let productId = "";
  const seenTerms: CollectTerm[][] = [];

  it("drafts the profile and 20 to 30 search terms from the domain, reading only the user's site", async () => {
    const fetched: string[] = [];
    const client = new FakeLlmClient([
      { stopReason: "end_turn", text: JSON.stringify(DRAFT), usage },
    ]);
    const llmUsage = new FakeUsageStore();
    const clock = { now: () => NOW };
    const result = await draftFromInput(OWNER, "latepay.example", {
      llm: createLlm({
        client,
        usage: llmUsage,
        clock,
        caps: { productMonthlyUsd: 3, dailyUsd: 25 },
      }),
      usage: llmUsage,
      store: draftStore,
      clock,
      reader: {
        now: () => 0,
        fetchPage: async (url): Promise<OwnSitePage> => {
          fetched.push(url);
          const body = SITE[url];
          if (url.endsWith("/robots.txt")) return { url, contentType: "text/plain", body: "" };
          if (!body) throw new Error("not found");
          return { url, contentType: "text/html", body };
        },
      },
    });
    expect(result.kind).toBe("drafted");
    if (result.kind !== "drafted") return;
    productId = result.productId;
    expect(fetched.every((u) => u.startsWith("https://latepay.example/"))).toBe(true);
    expect(fetched).not.toContain("https://latepay.example/team");
    expect(client.requests[0]?.input).toContain("LatePay chases late invoices");

    const saved = await asOwner(async () => ({
      product: (
        await db.query<{ status: string; name: string; url: string }>(
          "select status, name, url from public.products where id = $1",
          [productId],
        )
      ).rows[0],
      terms: (
        await db.query<{ n: number }>(
          "select count(*)::int as n from public.search_terms where product_id = $1",
          [productId],
        )
      ).rows[0]!.n,
      rivals: (
        await db.query<{ name: string }>(
          "select name from public.competitors where product_id = $1",
          [productId],
        )
      ).rows.map((r) => r.name),
    }));
    expect(saved.product).toEqual({
      status: "draft",
      name: "LatePay",
      url: "https://latepay.example/",
    });
    expect(saved.terms).toBeGreaterThanOrEqual(20);
    expect(saved.terms).toBeLessThanOrEqual(30);
    expect(saved.rivals).toEqual(["Invoicely"]);
  });

  it("collects nothing while the product is a draft or the account is not entitled", async () => {
    expect(await termsFor(productId, fakeHackerNews(seenTerms))).toBeNull();
  });

  it("confirms in one click as the owner, and the database stamps confirmed_at", async () => {
    const confirmed = await asOwner(
      async () =>
        (
          await db.query<{ confirmed_at: Date | null }>(
            "update public.products set status = 'active' where id = $1 and status = 'draft' returning confirmed_at",
            [productId],
          )
        ).rows,
    );
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.confirmed_at).not.toBeNull();
    // Checkout: the webhook's billing patch makes the account entitled.
    await db.query("update public.profiles set subscription_status = 'trialing' where id = $1", [
      OWNER,
    ]);
  });

  it("runs the daily collect job on the enabled source, classifies, stores only relevant posts and shows them in Today", async () => {
    const jobs = new FakeJobStore();
    const source = fakeHackerNews(seenTerms);
    const client = new FakeLlmClient([classify]);
    const llm = createLlm({
      client,
      usage: new FakeUsageStore(),
      clock: { now: () => NOW },
      caps: { productMonthlyUsd: 3, dailyUsd: 25 },
    });
    const collect = createCollectHandler({
      sourceFor: (id) => (id === source.id ? source : null),
      fetchFor: () => async () => {
        throw new Error("the fake source makes no request");
      },
      budget: new FakeBudget(jobs),
      terms: termsFor,
      process: createCollectStep({
        store: collectStore,
        classifier: createClassifier({ llm, profiles }),
        hash: (src, key) => `hash-${src}-${key}`.padEnd(64, "0").slice(0, 64),
      }),
      ready: () => null,
      monthlyCap: () => null,
      userAgent: "AskedFor test",
      sleep: async () => {},
    });

    const result = await runDailyCron({
      store: jobs,
      handlers: { collect },
      products: async () =>
        asService(async () =>
          (await db.query<{ id: string }>("select id from public.collectable_products()")).rows.map(
            (r) => r.id,
          ),
        ),
      sources: [source],
      clock: () => NOW,
    });
    expect(result.status).toBe(200);
    expect(jobs.jobs.map((j) => [j.kind, j.source, j.status])).toEqual([
      ["collect", "hackernews", "done"],
    ]);
    expect(seenTerms.at(-1)?.length).toBe(TERMS.length);
    expect(client.requests).toHaveLength(1);

    const { where, params } = toSql(
      feedConditions(productId, parseFeedParams({}), "today", NOW, 60),
    );
    const feed = await asOwner(
      async () =>
        (
          await db.query<{ url: string; excerpt: string; category: string; reason: string }>(
            `select url, excerpt, category, reason from public.feed_items where ${where}`,
            params,
          )
        ).rows,
    );
    expect(feed).toEqual([
      {
        url: "https://news.hn.example/item?id=9001",
        excerpt: "Ask HN: what do you use to chase unpaid invoices from clients?",
        category: "looking_for_tool",
        reason: "Asks for a way to chase unpaid invoices.",
      },
    ]);
    // The post rated not relevant was discarded in memory, never stored (2.3.3).
    const stored = await db.query<{ n: number }>("select count(*)::int as n from public.posts");
    expect(stored.rows[0]!.n).toBe(1);
  });
});

/** feedConditions as SQL, as tests/db/feed.test.ts reads them. */
function toSql(conditions: ReturnType<typeof feedConditions>) {
  const params: unknown[] = [];
  const where = conditions.map((c) => {
    params.push(c.value);
    const p = `$${params.length}`;
    switch (c.op) {
      case "eq":
        return `${c.column} = ${p}`;
      case "neq":
        return `${c.column} <> ${p}`;
      case "gte":
        return `${c.column} >= ${p}`;
      case "in":
        return `${c.column} = any(${p})`;
      case "ilike":
        return `${c.column} ilike ${p}`;
    }
  });
  return { where: where.join(" and "), params };
}

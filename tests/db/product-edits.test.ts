import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withRole } from "./harness";

/**
 * Migration `product_edits_and_event_cap` (code review of the redesign, 27 Nov 2026):
 * - apply_product_edits saves a confirmed product's profile and its search terms in one
 *   transaction, as the owner (security invoker, RLS applies), so a failed term never leaves the
 *   product half saved or with no terms. Drafts stay with apply_onboarding_edits.
 * - record_public_event writes the homepage's two anonymous events under a daily cap per name, so
 *   nobody can fill the table or skew the counts by posting in a loop.
 */

let seq = 0;
const newId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

describe("apply_product_edits", () => {
  let db: PGlite;
  const as = <T>(user: string, fn: () => Promise<T>) => withRole(db, "authenticated", user, fn);
  const profile = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      name: "Renamed",
      url: "https://new.example/",
      one_liner: "One line",
      description: "What it does",
      audience: "Who it is for",
      relevance_threshold: 45,
      ...over,
    });
  const terms = (...list: [string, string][]) =>
    JSON.stringify(list.map(([term, intent]) => ({ term, intent })));
  const apply = (user: string, product: string, p: string, t: string) =>
    as(user, () =>
      db.query("select public.apply_product_edits($1, $2::jsonb, $3::jsonb)", [product, p, t]),
    );
  const termsOf = async (product: string) =>
    (
      await db.query<{ term: string; intent: string }>(
        "select term, intent from public.search_terms where product_id = $1 order by term",
        [product],
      )
    ).rows;

  async function owner(status: "active" | "draft" = "active") {
    const user = newId();
    await db.query("insert into auth.users (id) values ($1)", [user]);
    const product = await as(user, async () => {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (owner_id, url, name) values ($1, 'https://p.example/', 'P') returning id",
        [user],
      );
      const id = rows[0]!.id;
      await db.query(
        "insert into public.search_terms (product_id, term, intent) values ($1, 'late invoices', 'problem'), ($1, 'acme', 'competitor')",
        [id],
      );
      if (status === "active")
        await db.query("update public.products set status = 'active' where id = $1", [id]);
      return id;
    });
    return { user, product };
  }

  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(() => db.close());

  it("saves the profile and the terms together: removals, case changes and additions", async () => {
    const { user, product } = await owner();
    await apply(
      user,
      product,
      profile(),
      terms(["Acme", "competitor"], ["chasing late payments", "problem"]),
    );
    expect(await termsOf(product)).toEqual([
      { term: "Acme", intent: "competitor" },
      { term: "chasing late payments", intent: "problem" },
    ]);
    const { rows } = await db.query<{ name: string; relevance_threshold: number }>(
      "select name, relevance_threshold from public.products where id = $1",
      [product],
    );
    expect(rows).toEqual([{ name: "Renamed", relevance_threshold: 45 }]);
  });

  it("saves nothing when any part fails: a term the database refuses rolls the profile back", async () => {
    const { user, product } = await owner();
    await expect(
      apply(user, product, profile(), terms(["@somebody", "problem"])),
    ).rejects.toThrow();
    expect(await termsOf(product)).toEqual([
      { term: "acme", intent: "competitor" },
      { term: "late invoices", intent: "problem" },
    ]);
    const { rows } = await db.query<{ name: string }>(
      "select name from public.products where id = $1",
      [product],
    );
    expect(rows).toEqual([{ name: "P" }]);
  });

  it("refuses to leave a product with no search terms", async () => {
    const { user, product } = await owner();
    await expect(apply(user, product, profile(), "[]")).rejects.toThrow(/at least one/);
    expect(await termsOf(product)).toHaveLength(2);
  });

  it("removes a term that feed posts and term stats point at", async () => {
    const { user, product } = await owner();
    const term = (
      await db.query<{ id: string }>(
        "select id from public.search_terms where product_id = $1 and term = 'acme'",
        [product],
      )
    ).rows[0]!.id;
    await db.query(
      "insert into public.term_stats (term_id, source, day, fetched, relevant) values ($1, 'hackernews', '2026-11-27', 3, 1)",
      [term],
    );
    const link = await withRole(db, "service_role", null, async () => {
      const { rows: post } = await db.query<{ id: string }>(
        `select public.ingest_post('hackernews', 'e2e-x1', 'https://news.ycombinator.com/item?id=1',
           'Example post', now(), 'example-hash', 'Hacker News', now()) as id`,
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into public.product_posts (product_id, post_id, relevance, category, reason, term_id)
         values ($1, $2, 60, 'wish', 'Example reason', $3) returning id`,
        [product, post[0]!.id, term],
      );
      return rows[0]!.id;
    });
    await apply(user, product, profile(), terms(["late invoices", "problem"]));
    expect(await termsOf(product)).toEqual([{ term: "late invoices", intent: "problem" }]);
    // The post stays in the feed, without the term that found it.
    const { rows: kept } = await db.query<{ term_id: string | null }>(
      "select term_id from public.product_posts where id = $1",
      [link],
    );
    expect(kept).toEqual([{ term_id: null }]);
    const { rows } = await db.query("select 1 from public.term_stats where term_id = $1", [term]);
    expect(rows).toEqual([]);
  });

  it("never edits a draft (onboarding does) or another owner's product", async () => {
    const draft = await owner("draft");
    await expect(
      apply(draft.user, draft.product, profile(), terms(["x y", "problem"])),
    ).rejects.toThrow(/no confirmed product/);
    const mine = await owner();
    const stranger = await owner();
    await expect(
      apply(stranger.user, mine.product, profile(), terms(["mine now", "problem"])),
    ).rejects.toThrow(/no confirmed product/);
    expect(await termsOf(mine.product)).toHaveLength(2);
  });

  it("is not callable by anon", async () => {
    const { product } = await owner();
    await expect(
      withRole(db, "anon", null, () =>
        db.query("select public.apply_product_edits($1, $2::jsonb, $3::jsonb)", [
          product,
          profile(),
          terms(["x y", "problem"]),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("record_public_event", () => {
  let db: PGlite;
  const record = (name: string, props: string, cap: number, now = "2026-11-27T12:00:00Z") =>
    withRole(db, "service_role", null, () =>
      db.query<{ ok: boolean }>("select public.record_public_event($1, $2::jsonb, $3, $4) as ok", [
        name,
        props,
        now,
        cap,
      ]),
    ).then((r) => r.rows[0]!.ok);

  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(() => db.close());

  it("records with no user until today's cap for that name, then refuses", async () => {
    for (let i = 0; i < 3; i++)
      expect(await record("cta_clicked", '{"placement":"hero"}', 3)).toBe(true);
    expect(await record("cta_clicked", '{"placement":"hero"}', 3)).toBe(false);
    // Each name has its own cap, and the next UTC day starts again.
    expect(await record("example_viewed", "{}", 3)).toBe(true);
    expect(await record("cta_clicked", '{"placement":"hero"}', 3, "2026-11-28T00:00:01Z")).toBe(
      true,
    );
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.events where user_id is null",
    );
    expect(rows[0]!.n).toBe(5);
  });

  it("refuses any other event name", async () => {
    await expect(record("signed_up", "{}", 10)).rejects.toThrow(/not a public event/);
  });

  it("only the service role may call it", async () => {
    for (const role of ["anon", "authenticated"] as const)
      await expect(
        withRole(db, role, role === "anon" ? null : newId(), () =>
          db.query("select public.record_public_event('example_viewed', '{}'::jsonb, now(), 10)"),
        ),
      ).rejects.toThrow(/permission denied/);
  });
});

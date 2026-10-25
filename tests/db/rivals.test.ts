import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, createDb, migrationNamed, withRole } from "./harness";

/** Migration `rivals` (docs/PLAN.md 6.5, 4.5): insights, counts, discovered tools, switchers. */

const MIGRATION = migrationNamed("rivals");
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const WEEK_START = new Date(NOW.getTime() - 7 * 86_400_000);
const DAY = 86_400_000;

let db: PGlite;
let alice = "";
let bob = "";
let ledgerly = "";
let paidly = "";

const asAlice = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", ALICE, fn);
const asBob = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", BOB, fn);

let seq = 0;
async function link(input: {
  product: string;
  competitor?: string | null;
  tool?: string | null;
  issue?: string | null;
  sentiment?: string | null;
  switching?: boolean;
  state?: string;
  linkedAt?: Date;
}) {
  const n = ++seq;
  const post = (
    await db.query<{ id: string }>(
      `insert into public.posts (source, external_id, url, excerpt, posted_at, collected_at, delete_after, author_hash)
       values ('hackernews', $1, $2, 'Synthetic excerpt', $3, $3, $3::timestamptz + interval '30 days', 'h') returning id`,
      [`r${n}`, `https://news.ycombinator.com/item?id=${n}`, NOW.toISOString()],
    )
  ).rows[0]!.id;
  await db.query(
    `insert into public.product_posts (product_id, post_id, relevance, category, reason, competitor_id,
       tool_mentioned, rival_issue, rival_sentiment, switching, state, created_at)
     values ($1, $2, 80, 'mentions_competitor', 'r', $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.product,
      post,
      input.competitor ?? null,
      input.tool ?? null,
      input.issue ?? null,
      input.sentiment ?? null,
      input.switching ?? false,
      input.state ?? "new",
      (input.linkedAt ?? new Date(NOW.getTime() - DAY)).toISOString(),
    ],
  );
}

beforeAll(async () => {
  db = await createDb({ before: MIGRATION });
  await applyMigrationsFrom(db, MIGRATION);
  await db.query("insert into auth.users (id) values ($1), ($2)", [ALICE, BOB]);
  const product = async (owner: string, name: string) =>
    (
      await db.query<{ id: string }>(
        "insert into public.products (owner_id, url, name, status) values ($1, 'https://x.example.test', $2, 'active') returning id",
        [owner, name],
      )
    ).rows[0]!.id;
  alice = await product(ALICE, "Invoicer");
  bob = await product(BOB, "Other");
  const competitor = async (name: string, aliases: string[] = []) =>
    (
      await db.query<{ id: string }>(
        "insert into public.competitors (product_id, name, aliases) values ($1, $2, $3) returning id",
        [alice, name, aliases],
      )
    ).rows[0]!.id;
  ledgerly = await competitor("Ledgerly", ["Ledgerly App"]);
  paidly = await competitor("Paidly");

  // Ledgerly pricing: 3 negative, 1 mixed, 1 positive; 2 want to switch.
  for (const sentiment of ["negative", "negative", "negative", "mixed", "positive"])
    await link({ product: alice, competitor: ledgerly, issue: "pricing", sentiment });
  await link({
    product: alice,
    competitor: ledgerly,
    issue: "pricing",
    sentiment: "negative",
    switching: true,
  });
  await link({
    product: alice,
    competitor: ledgerly,
    issue: "support",
    sentiment: "mixed",
    switching: true,
  });
  // Paidly: one reliability complaint, one from 10 days ago (outside the week).
  await link({ product: alice, competitor: paidly, issue: "reliability", sentiment: "negative" });
  await link({
    product: alice,
    competitor: paidly,
    issue: "reliability",
    sentiment: "negative",
    linkedAt: new Date(NOW.getTime() - 10 * DAY),
  });
  // Discovered tools, including an alias of Ledgerly and the product's own name.
  await link({ product: alice, tool: "Billwise", issue: "usability", sentiment: "negative" });
  await link({
    product: alice,
    tool: "billwise",
    issue: "usability",
    sentiment: "mixed",
    switching: true,
  });
  await link({ product: alice, tool: "ledgerly app" });
  await link({ product: alice, tool: "Invoicer" });
  await link({ product: alice, tool: "Clockly" });
  // A hidden switcher, and Bob's own.
  await link({
    product: alice,
    competitor: paidly,
    issue: "pricing",
    sentiment: "negative",
    switching: true,
    state: "hidden",
  });
  await link({
    product: bob,
    tool: "Secretly",
    issue: "pricing",
    sentiment: "negative",
    switching: true,
  });
});

afterAll(async () => {
  await db.close();
});

describe("rival_insights", () => {
  const insert = (
    product: string,
    competitor: string | null,
    tool: string | null,
    issue = "pricing",
  ) =>
    db.query(
      `insert into public.rival_insights (product_id, competitor_id, tool_name, week, issue, complaints, switching, summary)
       values ($1, $2, $3, '2026-10-19', $4, 1, 0, 'Our own words.')`,
      [product, competitor, tool, issue],
    );

  it("the owner reads their insights and another user cannot", async () => {
    await insert(alice, ledgerly, null);
    expect(
      (await asAlice(() => db.query("select id from public.rival_insights"))).rows,
    ).toHaveLength(1);
    expect((await asBob(() => db.query("select id from public.rival_insights"))).rows).toHaveLength(
      0,
    );
  });

  it("API roles cannot write", async () => {
    await expect(
      asAlice(() =>
        db.query(
          `insert into public.rival_insights (product_id, competitor_id, week, issue, complaints, switching, summary)
           values ($1, $2, '2026-10-19', 'other', 1, 0, 'x')`,
          [alice, ledgerly],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAlice(() => db.query("update public.rival_insights set complaints = 99")),
    ).rejects.toThrow(/permission denied/);
    await expect(asAlice(() => db.query("delete from public.rival_insights"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      withRole(db, "anon", null, () => db.query("select * from public.rival_insights")),
    ).rejects.toThrow(/permission denied/);
  });

  it("holds one row per tracked rival, week and issue", async () => {
    await expect(insert(alice, ledgerly, null)).rejects.toThrow(/duplicate key/);
    await insert(alice, ledgerly, null, "support");
  });

  it("holds one row per discovered tool (any case), week and issue", async () => {
    await insert(alice, null, "Billwise");
    await expect(insert(alice, null, "BILLWISE")).rejects.toThrow(/duplicate key/);
  });

  it("needs a competitor or a tool name, and caps examples at 3", async () => {
    await expect(insert(alice, null, null, "other")).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into public.rival_insights (product_id, competitor_id, week, issue, complaints, switching, summary, example_post_ids)
         values ($1, $2, '2026-10-19', 'other', 1, 0, 'x', array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])`,
        [alice, ledgerly],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("rival_counts", () => {
  const counts = async (as = asAlice, product = alice) =>
    (
      await as(() =>
        db.query<{
          competitor_id: string | null;
          tool_name: string | null;
          issue: string;
          complaints: number;
          switching: number;
        }>("select * from public.rival_counts($1, $2, $3) order by issue, tool_name", [
          product,
          WEEK_START.toISOString(),
          NOW.toISOString(),
        ]),
      )
    ).rows;

  it("counts complaints (negative or mixed) and switchers per rival and issue, this week only", async () => {
    const rows = await counts();
    const find = (c: string | null, tool: string | null, issue: string) =>
      rows.find(
        (r) =>
          r.competitor_id === c &&
          (tool === null || r.tool_name?.toLowerCase() === tool) &&
          r.issue === issue,
      );
    expect(find(ledgerly, null, "pricing")).toMatchObject({ complaints: 5, switching: 1 });
    expect(find(ledgerly, null, "support")).toMatchObject({ complaints: 1, switching: 1 });
    expect(find(paidly, null, "reliability")).toMatchObject({ complaints: 1, switching: 0 });
    expect(find(null, "billwise", "usability")).toMatchObject({ complaints: 2, switching: 1 });
  });

  it("returns nothing of another user's", async () => {
    expect(await counts(asBob, alice)).toEqual([]);
  });
});

describe("discovered_tools", () => {
  it("lists untracked tools, case-folded, without competitors, their aliases or the product", async () => {
    const { rows } = await asAlice(() =>
      db.query<{ tool_name: string; mentions: number }>(
        "select * from public.discovered_tools($1, $2, $3)",
        [alice, WEEK_START.toISOString(), NOW.toISOString()],
      ),
    );
    expect(rows.map((r) => [r.tool_name.toLowerCase(), r.mentions])).toEqual([
      ["billwise", 2],
      ["clockly", 1],
    ]);
  });
});

describe("rival_switchers", () => {
  it("lists switchers that are not hidden, for one rival or all, never another user's", async () => {
    const all = await asAlice(() =>
      db.query<{ competitor_name: string | null; switching: boolean }>(
        "select * from public.rival_switchers($1)",
        [alice],
      ),
    );
    expect(all.rows).toHaveLength(3);
    expect(all.rows.every((r) => r.switching)).toBe(true);
    const one = await asAlice(() =>
      db.query("select * from public.rival_switchers($1, $2)", [alice, ledgerly]),
    );
    expect(one.rows).toHaveLength(2);
    const foreign = await asBob(() =>
      db.query("select * from public.rival_switchers($1)", [alice]),
    );
    expect(foreign.rows).toHaveLength(0);
  });
});

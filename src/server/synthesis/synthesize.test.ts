import { describe, expect, it } from "vitest";
import type { Llm, StructuredCall } from "@/server/llm/llm";
import type { Job } from "@/server/pipeline/ports";
import { hasHandle, quotesAny, trendFor, weekOf } from "./checks";
import type { BuildSynthesis, RivalSynthesis } from "./schema";
import {
  createSynthesizeHandler,
  type RivalRow,
  type SynthesisStore,
  type ThemeRow,
  type WeekPost,
} from "./synthesize";

const NOW = new Date("2026-10-25T21:00:00Z"); // Sunday evening
const WEEK = "2026-10-19";
const LEDGERLY = "11111111-1111-4111-8111-111111111111";

const excerpt = (i: number) =>
  `Synthetic post ${i}: I keep chasing clients who pay late and need a better reminder tool for invoices`;

function posts(): WeekPost[] {
  const list: WeekPost[] = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    category: i < 3 ? "looking_for_tool" : "wish",
    excerpt: excerpt(i),
    competitorId: null,
    toolMentioned: null,
    rival: null,
  }));
  // Rival posts: Ledgerly pricing x3 (2 negative, 1 positive, 1 switching), Billwise usability x1.
  list.push(
    {
      id: "r1",
      category: "mentions_competitor",
      excerpt: "Ledgerly raised prices again",
      competitorId: LEDGERLY,
      toolMentioned: null,
      rival: { issue: "pricing", sentiment: "negative", switching: true },
    },
    {
      id: "r2",
      category: "mentions_competitor",
      excerpt: "Ledgerly costs too much now",
      competitorId: LEDGERLY,
      toolMentioned: null,
      rival: { issue: "pricing", sentiment: "negative", switching: false },
    },
    {
      id: "r3",
      category: "mentions_competitor",
      excerpt: "Ledgerly pricing is fine for me",
      competitorId: LEDGERLY,
      toolMentioned: null,
      rival: { issue: "pricing", sentiment: "positive", switching: false },
    },
    {
      id: "r4",
      category: "pain_point",
      excerpt: "Billwise menus are confusing",
      competitorId: null,
      toolMentioned: "Billwise",
      rival: { issue: "usability", sentiment: "mixed", switching: false },
    },
  );
  return list;
}

function fakeStore(weekPosts = posts()) {
  const saved: { themes: ThemeRow[]; rivals: RivalRow[] } = { themes: [], rivals: [] };
  const store: SynthesisStore = {
    product: async () => ({
      name: "Invoicer",
      oneLiner: null,
      competitors: [{ id: LEDGERLY, name: "Ledgerly" }],
    }),
    weekPosts: async () => weekPosts,
    lastThemes: async () => [{ kind: "ask", themeKey: "invoice-reminders", count: 10 }],
    lastRivals: async () => [
      { competitorId: LEDGERLY, toolName: null, issue: "pricing", complaints: 1 },
    ],
    saveThemes: async (_p, week, rows) => {
      expect(week).toBe(WEEK);
      saved.themes = rows;
    },
    saveRivals: async (_p, _w, rows) => {
      saved.rivals = rows;
    },
  };
  return { store, saved };
}

const goodBuild: BuildSynthesis = {
  themes: [
    {
      theme_key: "invoice-reminders",
      kind: "ask",
      title: "Automatic payment nudges",
      summary: "Several freelancers want a tool that follows up on unpaid bills for them.",
      post_ids: ["p0", "p1", "p2", "p3", "unknown-id"],
    },
    {
      theme_key: "late-fees",
      kind: "wish",
      title: "Late fees",
      summary: "People wish their billing app added fees on overdue bills.",
      post_ids: ["p4"],
    },
  ],
  opportunities: [
    {
      theme_key: "reminder-sequences",
      title: "Reminder sequences",
      summary: "A follow-up schedule that stops when the client pays.",
      post_ids: ["p0", "p5"],
    },
  ],
};
const goodRivals: RivalSynthesis = {
  rivals: [
    {
      competitor_key: "c1",
      tool_name: null,
      issue: "pricing",
      summary: "Recent price rises push smaller customers to look elsewhere.",
      post_ids: ["r1", "r2"],
    },
    {
      competitor_key: null,
      tool_name: "Billwise",
      issue: "usability",
      summary: "Its menus are hard to find your way around.",
      post_ids: ["r4"],
    },
    {
      competitor_key: "c9",
      tool_name: null,
      issue: "support",
      summary: "Unknown key.",
      post_ids: ["r1"],
    },
  ],
  fixes: [
    {
      theme_key: "clear-pricing",
      title: "Clear flat pricing",
      summary: "One simple plan answers the main complaint.",
      post_ids: ["r1"],
    },
  ],
};

function fakeLlm(replies: unknown[]) {
  const calls: StructuredCall<unknown>[] = [];
  const llm: Llm = {
    async callStructured<T>(call: StructuredCall<T>): Promise<T> {
      calls.push(call as StructuredCall<unknown>);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return call.schema.parse(next);
    },
    capReached: async () => null,
  };
  return { llm, calls };
}

const job: Job = {
  id: "j",
  kind: "synthesize",
  productId: "prod",
  source: null,
  status: "running",
  payload: {},
  attempts: 1,
  runAfter: NOW,
};
const ctx = { now: () => NOW, deadline: Infinity };

describe("weekly synthesis", () => {
  it("counts come from labels, not the model; unknown post ids are dropped; at most 3 examples", async () => {
    const { store, saved } = fakeStore();
    const { llm } = fakeLlm([goodBuild, goodRivals]);
    await createSynthesizeHandler({ llm, store })(job, ctx);
    const reminders = saved.themes.find((t) => t.themeKey === "invoice-reminders")!;
    expect(reminders.count).toBe(4);
    expect(reminders.examplePostIds).toEqual(["p0", "p1", "p2"]);
    const pricing = saved.rivals.find((r) => r.issue === "pricing")!;
    expect(pricing).toMatchObject({ competitorId: LEDGERLY, complaints: 2, switching: 1 });
    const billwise = saved.rivals.find((r) => r.toolName === "Billwise")!;
    expect(billwise).toMatchObject({ complaints: 1, switching: 0 });
    expect(saved.rivals.some((r) => r.issue === "support")).toBe(false);
  });

  it("computes trends against last week's row with the same key", async () => {
    const { store, saved } = fakeStore();
    const { llm } = fakeLlm([goodBuild, goodRivals]);
    await createSynthesizeHandler({ llm, store })(job, ctx);
    expect(saved.themes.find((t) => t.themeKey === "invoice-reminders")!.trend).toBe("down");
    expect(saved.themes.find((t) => t.themeKey === "late-fees")!.trend).toBe("new");
    expect(saved.rivals.find((r) => r.issue === "pricing")!.trend).toBe("up");
    expect(saved.rivals.find((r) => r.toolName === "Billwise")!.trend).toBe("new");
  });

  it("saves opportunities as kind opportunity and fixes as kind rival_fix", async () => {
    const { store, saved } = fakeStore();
    const { llm } = fakeLlm([goodBuild, goodRivals]);
    await createSynthesizeHandler({ llm, store })(job, ctx);
    expect(saved.themes.map((t) => [t.kind, t.themeKey])).toEqual(
      expect.arrayContaining([
        ["opportunity", "reminder-sequences"],
        ["rival_fix", "clear-pricing"],
      ]),
    );
  });

  it("a summary copying 8 or more words of an excerpt is regenerated once, then dropped", async () => {
    const quoting: BuildSynthesis = {
      ...goodBuild,
      themes: [
        {
          ...goodBuild.themes[0]!,
          summary:
            "As one put it: I keep chasing clients who pay late and need a better reminder tool.",
        },
      ],
    };
    const { store, saved } = fakeStore();
    const { llm, calls } = fakeLlm([quoting, quoting, goodRivals]);
    await createSynthesizeHandler({ llm, store })(job, ctx);
    expect(
      calls.filter((c) => c.schema !== undefined && c.input.includes("<last_week>")),
    ).toHaveLength(2);
    expect(calls[1]!.input).toContain("Rewrite those items in your own words");
    expect(saved.themes.find((t) => t.themeKey === "invoice-reminders")).toBeUndefined();
  });

  it("keeps the regenerated item when the second answer is clean", async () => {
    const quoting: BuildSynthesis = {
      ...goodBuild,
      themes: [
        {
          ...goodBuild.themes[0]!,
          summary: "I keep chasing clients who pay late and need a better reminder tool.",
        },
      ],
    };
    const { store, saved } = fakeStore();
    const { llm } = fakeLlm([quoting, goodBuild, goodRivals]);
    await createSynthesizeHandler({ llm, store })(job, ctx);
    expect(saved.themes.find((t) => t.themeKey === "invoice-reminders")).toBeDefined();
  });

  it("rejects handles", async () => {
    const naming: RivalSynthesis = {
      ...goodRivals,
      rivals: [{ ...goodRivals.rivals[0]!, summary: "As @jane_doe said, it costs too much." }],
    };
    const { store, saved } = fakeStore();
    const { llm } = fakeLlm([goodBuild, naming, naming]);
    await createSynthesizeHandler({ llm, store })(job, ctx);
    expect(saved.rivals.find((r) => r.issue === "pricing")!.summary).toBe("");
  });

  it("does nothing for a product with fewer than 5 relevant posts that week", async () => {
    const { store } = fakeStore(posts().slice(0, 4));
    const { llm, calls } = fakeLlm([]);
    expect(await createSynthesizeHandler({ llm, store })(job, ctx)).toEqual({
      status: "done",
      payload: { result: "too_few", posts: 4 },
    });
    expect(calls).toHaveLength(0);
  });

  it("uses the synthesize task and Sonnet", async () => {
    const { store } = fakeStore();
    const { llm, calls } = fakeLlm([goodBuild, goodRivals]);
    await createSynthesizeHandler({ llm, store })(job, ctx);
    expect(calls.map((c) => [c.task, c.model])).toEqual([
      ["synthesize", "claude-sonnet-5-5"],
      ["synthesize", "claude-sonnet-5-5"],
    ]);
  });
});

describe("checks", () => {
  it("finds 8 consecutive shared words, not 7", () => {
    const ex = "one two three four five six seven eight nine";
    expect(quotesAny("x one two three four five six seven eight y", [ex])).toBe(true);
    expect(quotesAny("x one two three four five six seven y", [ex])).toBe(false);
  });

  it.each(["@jane_doe", "thanks u/someone", "see /u/some-one", "hi @a.b"])(
    "finds the handle in %j",
    (t) => {
      expect(hasHandle(t)).toBe(true);
    },
  );

  it.each(["email support", "price is 20 @ month", "U/X ratio"])("does not flag %j", (t) => {
    expect(hasHandle(t)).toBe(false);
  });

  it("trends at 20 percent", () => {
    expect(trendFor(12, 10)).toBe("up");
    expect(trendFor(11, 10)).toBe("flat");
    expect(trendFor(8, 10)).toBe("down");
    expect(trendFor(3, undefined)).toBe("new");
  });

  it("weeks start on Monday, London time", () => {
    expect(weekOf(new Date("2026-10-25T21:00:00Z"))).toBe("2026-10-19");
    expect(weekOf(new Date("2026-10-26T00:30:00Z"))).toBe("2026-10-26");
    expect(weekOf(new Date("2026-07-05T23:30:00Z"))).toBe("2026-07-06");
  });
});

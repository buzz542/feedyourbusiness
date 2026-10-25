import { describe, expect, it } from "vitest";
import { hasHandle } from "@/server/synthesis/checks";
import { renderBuildReport } from "./export";
import { groupThemes, type BuildTheme } from "./view";

const EXCERPT = "Is there an app that sends invoice reminders automatically for me";
const theme = (over: Partial<BuildTheme>): BuildTheme => ({
  id: Math.random().toString(),
  kind: "ask",
  themeKey: "k",
  title: "Automatic payment nudges",
  summary: "Freelancers want follow-ups on unpaid bills without writing them.",
  count: 4,
  trend: "up",
  evidence: [
    {
      id: "p1",
      url: "https://news.ycombinator.com/item?id=1",
      source: "hackernews",
      community: "Hacker News",
    },
  ],
  ...over,
});

describe("Build grouping", () => {
  const groups = groupThemes([
    theme({ kind: "ask", count: 2, title: "B" }),
    theme({ kind: "pain", count: 5, title: "A" }),
    theme({ kind: "wish", title: "W" }),
    theme({ kind: "opportunity", count: 3, title: "O1" }),
    theme({ kind: "rival_fix", count: 9, title: "R1" }),
    theme({ kind: "opportunity", count: 1, title: "O2" }),
    theme({ kind: "opportunity", count: 2, title: "O3" }),
  ]);

  it("themes are asks and pains by count; wishes apart; up to 3 next across opportunities and rival gaps", () => {
    expect(groups.themes.map((t) => t.title)).toEqual(["A", "B"]);
    expect(groups.wishes.map((t) => t.title)).toEqual(["W"]);
    expect(groups.next.map((t) => t.title)).toEqual(["R1", "O1", "O3"]);
  });

  it("keeps at most 8 themes", () => {
    const many = groupThemes(
      Array.from({ length: 12 }, (_, i) => theme({ title: `T${i}`, count: i })),
    );
    expect(many.themes).toHaveLength(8);
  });
});

describe("Build export", () => {
  const md = renderBuildReport({
    week: "2026-10-19",
    productName: "Invoicer",
    groups: groupThemes([
      theme({}),
      theme({ kind: "wish", title: "Late fees" }),
      theme({ kind: "opportunity", title: "Reminder sequences" }),
    ]),
  });

  it("matches the screen: sections, counts, trends, summaries", () => {
    expect(md).toContain("## Themes this week");
    expect(md).toContain("## Wished it existed");
    expect(md).toContain("## What to build next");
    expect(md).toContain("Ask · 4 posts · up from last week");
    expect(md).toContain("Freelancers want follow-ups");
  });

  it("links posts without excerpts, quotes or handles", () => {
    expect(md).toContain("[Post 1](https://news.ycombinator.com/item?id=1)");
    expect(md).not.toContain(EXCERPT);
    expect(hasHandle(md)).toBe(false);
    expect(md).toContain("Say you built it");
  });
});

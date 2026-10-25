import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DISCLOSURE } from "@/lib/reply-tips";
import { ThemeCard } from "./build/theme-card";
import { RivalScorecard } from "./rivals/rival-scorecard";

describe("RivalScorecard", () => {
  const html = renderToStaticMarkup(
    <RivalScorecard
      card={{
        key: "c:1",
        name: "Ledgerly",
        complaints: 6,
        switching: 2,
        issues: [{ issue: "pricing", label: "Pricing", complaints: 5, trend: "up" }],
        history: [0, 1, 0, 2, 0, 0, 4, 2, 6],
        summaries: [{ issue: "pricing", text: "Price rises push small teams away." }],
      }}
    />,
  );

  it("shows complaints, switchers, issues with a trend in words, and a labeled sparkline", () => {
    expect(html).toContain("Ledgerly");
    expect(html).toContain("Complaints this week: </dt>");
    expect(html).toContain(">6<");
    expect(html).toContain("Pricing");
    expect(html).toContain("up from last week");
    expect(html).toContain('role="img"');
    expect(html).toContain("0, 1, 0, 2, 0, 0, 4, 2, 6");
    expect(html).toContain("Price rises push small teams away.");
  });

  it("shows no author names or handles", () => {
    expect(html).not.toMatch(/@|u\/|author/i);
  });
});

describe("ThemeCard", () => {
  const base = {
    id: "t1",
    kind: "ask" as const,
    themeKey: "invoice-reminders",
    title: "Automatic payment nudges",
    summary: "Freelancers want follow-ups on unpaid bills.",
    count: 4,
    trend: "new" as const,
  };

  it("links evidence posts with Say you built it", () => {
    const html = renderToStaticMarkup(
      <ThemeCard
        theme={{
          ...base,
          evidence: [
            {
              id: "p1",
              url: "https://news.ycombinator.com/item?id=1",
              source: "hackernews",
              community: "Hacker News",
            },
          ],
        }}
      />,
    );
    expect(html).toContain('href="https://news.ycombinator.com/item?id=1"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(DISCLOSURE);
    expect(html).toContain("4 posts");
    expect(html).toContain("new this week");
  });

  it("without evidence (the posts expired) shows the aggregate only", () => {
    const html = renderToStaticMarkup(<ThemeCard theme={{ ...base, evidence: [] }} />);
    expect(html).not.toContain("href");
    expect(html).not.toMatch(/@|u\//);
  });
});

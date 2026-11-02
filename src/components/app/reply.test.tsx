import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { REPLY_TIPS } from "@/server/reply/tips";
import { parseFeedParams, type FeedItem } from "@/server/store/feed";
import { linkSources, sources } from "@/sources/registry";
import { subredditSearchLinks, SUBREDDIT_LINK_HOST } from "@/sources/subreddit-links";
import { FeedError } from "./feed-error";
import { FirstRunProgress } from "./first-run-progress";
import { FilterBar } from "./filter-bar";
import { age, PostCard, sourceLine, unitRange } from "./post-card";
import { SearchLinksPanel } from "./search-links-panel";

/** Reply tab render tests (docs/PLAN.md 4.4, 4.9). Every post and name is invented. */

const NOW = new Date("2026-11-02T12:00:00Z");
const item: FeedItem = {
  id: "00000000-0000-4000-8000-000000000001",
  state: "new",
  relevance: 84,
  category: "looking_for_tool",
  reason: "Asks for a tool that chases late invoices.",
  createdAt: "2026-11-02T11:00:00Z",
  highlightStart: 2,
  highlightEnd: 22,
  competitorId: null,
  toolMentioned: null,
  switching: false,
  source: "reddit",
  url: "https://www.reddit.com/r/SaaS/comments/abc123/",
  excerpt: "🙏 Is there a tool that chases late invoices?",
  postedAt: "2026-11-02T09:00:00Z",
  community: "r/SaaS",
};
const setState = async () => ({ ok: true });

describe("PostCard", () => {
  const html = renderToStaticMarkup(
    <PostCard item={item} now={NOW} rivalName="Acme Invoices" setState={setState} />,
  );

  it("shows source and community, age, category, match, reason and the rival", () => {
    expect(html).toContain("Reddit · r/SaaS");
    expect(html).toContain(">3h<");
    expect(html).toContain("Looking for a tool");
    expect(html).toContain("84% match");
    expect(html).toContain("Why it matched: </span>Asks for a tool that chases late invoices.");
    expect(html).toContain("Acme Invoices");
  });

  it("marks exactly the highlighted words, counting the emoji once", () => {
    expect(html).toContain("<mark");
    expect(html).toMatch(/<mark[^>]*>Is there a tool that<\/mark>/);
  });

  it("opens the post in a new tab without an opener, next to the tip and the disclosure", () => {
    expect(html).toContain(
      'href="https://www.reddit.com/r/SaaS/comments/abc123/" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain("Say you built it.");
    expect(html).toContain(REPLY_TIPS.looking_for_tool);
    expect(html).toContain("Save");
    expect(html).toContain("Mark replied");
    expect(html).toContain("Hide");
  });

  it("shows no author anywhere", () => {
    expect(html).not.toMatch(/author|u\/|@/i);
  });

  it("formats sources, ages and ranges", () => {
    expect(sourceLine("hackernews", "Hacker News")).toBe("Hacker News");
    expect(sourceLine("bluesky", null)).toBe("Bluesky");
    expect(age("2026-11-02T11:45:00Z", NOW)).toBe("15m");
    expect(age("2026-10-30T12:00:00Z", NOW)).toBe("3d");
    expect(unitRange("🙏 ab", 2, 4)).toEqual({ start: 3, end: 5 });
    expect(unitRange("ab", 1, 3)).toBeNull();
    expect(unitRange("ab", null, null)).toBeNull();
  });
});

describe("FilterBar", () => {
  it("shows every filter with the current values, and keeps the view", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        filter={parseFeedParams({
          view: "saved",
          category: "wish",
          source: "bluesky",
          q: "invoice",
        })}
        defaultMin={60}
        rivals={[{ id: "00000000-0000-4000-8000-0000000000c1", name: "Acme Invoices" }]}
      />,
    );
    expect(html).toContain('name="view" value="saved"');
    expect(html).toMatch(/<option value="wish" selected="">Wish<\/option>/);
    expect(html).toMatch(/<option value="bluesky" selected="">Bluesky<\/option>/);
    expect(html).toContain("Acme Invoices");
    expect(html).toContain('value="60"');
    expect(html).toContain('value="invoice"');
  });
});

describe("search links", () => {
  const terms = ["late invoices", "chase payments & fees"];

  it("links every term on a declared link host over https, with the term encoded", () => {
    const declared = new Set(sources.flatMap((s) => s.linkHosts));
    const html = renderToStaticMarkup(
      <SearchLinksPanel
        terms={terms}
        subreddits={["freelance", "u_someone"]}
        sources={linkSources()}
      />,
    );
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
    expect(hrefs.length).toBeGreaterThan(terms.length);
    for (const href of hrefs) {
      const url = new URL(href);
      expect(url.protocol).toBe("https:");
      expect(declared.has(url.hostname) || url.hostname === SUBREDDIT_LINK_HOST).toBe(true);
      expect(href).not.toContain("chase payments & fees");
    }
    expect(html).toContain("Say you built it.");
    expect(html).toContain("r/freelance");
    expect(html).not.toContain("u_someone");
  });

  it("builds subreddit searches restricted to the community, skipping profiles and sensitive ones", () => {
    const links = subredditSearchLinks(["SaaS", "u_person", "depression", "bad name!"], ["a b"]);
    expect(links).toEqual([
      {
        subreddit: "SaaS",
        term: "a b",
        url: "https://www.reddit.com/r/SaaS/search/?q=a%20b&restrict_sr=1&sort=new",
      },
    ]);
  });
});

describe("loading, empty and error states", () => {
  it("renders skeleton cards with a live status", () => {
    const html = renderToStaticMarkup(<SkeletonCards count={2} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading posts");
  });

  it("says what to do next when the feed is empty", () => {
    const html = renderToStaticMarkup(
      <EmptyState title="Nothing here yet">Lower the minimum match.</EmptyState>,
    );
    expect(html).toContain("Nothing here yet");
  });

  it("offers a retry on error", () => {
    const html = renderToStaticMarkup(<FeedError retry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });
});

describe("first run progress", () => {
  it("names each source and its state, live", () => {
    const html = renderToStaticMarkup(
      <FirstRunProgress
        progress={[
          { source: "hackernews", status: "done" },
          { source: "reddit", status: "waiting" },
        ]}
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Hacker News: Done");
    expect(html).toContain("Reddit: Collecting");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseFeedFilters } from "@/lib/reply-filters";
import { DISCLOSURE, REPLY_TIPS } from "@/lib/reply-tips";
import type { FeedCard } from "@/server/reply/feed";
import { FilterBar } from "./filter-bar";
import { PostCard } from "./post-card";
import { SearchLinksPanel } from "./search-links-panel";

const NOW = new Date("2026-10-25T12:00:00Z");
const card: FeedCard = {
  id: "11111111-1111-4111-8111-111111111111",
  relevance: 87,
  category: "looking_for_tool",
  reason: "Asks for a tool that sends invoice reminders",
  state: "new",
  linkedAt: new Date("2026-10-25T10:00:00Z"),
  highlight: { start: 14, end: 18 },
  toolMentioned: null,
  rival: { id: "c1", name: "Ledgerly", issue: "pricing", switching: true },
  source: "reddit",
  community: "r/SaaS",
  url: "https://www.reddit.com/r/SaaS/comments/abc/",
  excerpt: "Anyone know a tool for invoice reminders?",
  postedAt: new Date("2026-10-25T09:00:00Z"),
};
const noop = async () => undefined;
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("PostCard", () => {
  const out = html(<PostCard card={card} now={NOW} action={noop} back="/app/reply" />);

  it("shows source and community, age, category and match", () => {
    expect(out).toContain("Reddit · r/SaaS");
    expect(out).toContain(">3h<");
    expect(out).toContain("Looking for a tool");
    expect(out).toContain("Match 87");
  });

  it("shows the excerpt with exactly the highlight marked", () => {
    expect(out).toMatch(/Anyone know a <mark[^>]*>tool<\/mark> for invoice reminders\?/);
  });

  it("shows the reason, the rival and switching intent", () => {
    expect(out).toContain("Asks for a tool that sends invoice reminders");
    expect(out).toContain("Rival: Ledgerly");
    expect(out).toContain("Looking to switch");
  });

  it("links to the post in a new tab with noopener noreferrer", () => {
    expect(out).toMatch(
      /<a href="https:\/\/www\.reddit\.com\/r\/SaaS\/comments\/abc\/" target="_blank" rel="noopener noreferrer"[^>]*>Open post<\/a>/,
    );
  });

  it("shows the fixed reply tip and the disclosure next to Open post", () => {
    expect(out).toContain(REPLY_TIPS.looking_for_tool);
    expect(out).toContain(DISCLOSURE);
    expect(out.indexOf(DISCLOSURE)).toBeGreaterThan(out.indexOf("Open post"));
  });

  it("offers Save, Mark replied and Hide on a new card, and Undo once acted on", () => {
    expect(out).toContain(">Save<");
    expect(out).toContain(">Mark replied<");
    expect(out).toContain(">Hide<");
    expect(out).not.toContain(">Undo<");
    const saved = html(
      <PostCard card={{ ...card, state: "saved" }} now={NOW} action={noop} back="/app/reply" />,
    );
    expect(saved).not.toContain(">Save<");
    expect(saved).toContain(">Undo<");
  });

  it("never shows an author", () => {
    expect(out).not.toMatch(/u\/|@|author/i);
  });
});

describe("FilterBar", () => {
  it("is a GET form on /app/reply that keeps the view and shows each filter", () => {
    const filters = parseFeedFilters({ view: "saved", category: "wish", q: "invoice" }, 60);
    const out = html(
      <FilterBar filters={filters} rivals={[{ id: "c1", name: "Ledgerly" }]} threshold={60} />,
    );
    expect(out).toMatch(/<form[^>]*method="get"/);
    expect(out).toMatch(/<form[^>]*action="\/app\/reply"/);
    expect(out).toContain('name="view" value="saved"');
    expect(out).toContain('value="invoice"');
    expect(out).toContain("Ledgerly");
    expect(out).toMatch(/<details open=""/);
  });

  it("is collapsed with no filter in use", () => {
    const out = html(<FilterBar filters={parseFeedFilters({}, 60)} rivals={[]} threshold={60} />);
    expect(out).not.toMatch(/<details open/);
  });
});

describe("SearchLinksPanel", () => {
  it("shows the disclosure above the links and opens them in a new tab", () => {
    const out = html(
      <SearchLinksPanel
        groups={[
          {
            label: "LinkedIn",
            links: [{ label: "invoice", url: "https://www.linkedin.com/x?q=invoice" }],
          },
        ]}
      />,
    );
    expect(out).toContain(DISCLOSURE);
    expect(out.indexOf(DISCLOSURE)).toBeLessThan(out.indexOf("linkedin.com"));
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

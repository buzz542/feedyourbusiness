import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CATEGORY_LABELS, REPLY_TIPS } from "@/server/reply/tips";
import { parseFeedParams, type FeedItem } from "@/server/store/feed";
import { linkSources, sources } from "@/sources/registry";
import { subredditSearchLinks } from "@/sources/subreddit-links";
import { FeedError } from "./feed-error";
import { FirstRunProgress } from "./first-run-progress";
import { FilterBar } from "./filter-bar";
import { age, PostCard, sourceLine, unitRange } from "./post-card";
import { nextState, PostActions } from "./post-actions";
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

/** The words a reader sees: tags and attributes removed, entities decoded. */
const visible = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The inner HTML of the first element carrying `attr`. */
function part(markup: string, attr: string): string {
  const open = new RegExp(`<(\\w+)[^>]*\\s${attr}=""[^>]*>`).exec(markup);
  if (!open) throw new Error(`no element with ${attr}`);
  const tag = open[1]!;
  let depth = 0;
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = open.index;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return markup.slice(open.index + open[0].length, m.index);
  }
  throw new Error(`unclosed ${tag}`);
}

describe("PostCard", () => {
  const html = renderToStaticMarkup(
    <PostCard item={item} now={NOW} rivalName="Acme Invoices" setState={setState} />,
  );

  it("puts source, community and posted time on one line, with the match score", () => {
    const meta = part(html, "data-card-meta");
    expect(visible(meta)).toBe("Reddit · r/SaaS · Posted 3h ago 84% match");
    expect(meta).not.toMatch(/<br|<div/);
    expect(meta).toContain('dateTime="2026-11-02T09:00:00Z"');
  });

  it("shows the excerpt as stored, all 280 characters, with exactly the highlighted words marked", () => {
    expect(part(html, "data-card-excerpt")).toMatch(/<mark[^>]*>Is there a tool that<\/mark>/);
    const long = "a".repeat(279) + "z";
    const full = renderToStaticMarkup(
      <PostCard
        item={{ ...item, excerpt: long, highlightStart: null, highlightEnd: null }}
        now={NOW}
        setState={setState}
      />,
    );
    expect(visible(part(full, "data-card-excerpt"))).toBe(long);
  });

  it("says why it matched in one line, with the category and the rival", () => {
    expect(html.match(/data-card-why=""/g)).toHaveLength(1);
    expect(visible(part(html, "data-card-why"))).toBe(
      "Looking for a tool Mentions Acme Invoices Why it matched: Asks for a tool that chases late invoices.",
    );
  });

  it("ends with one row of actions: Open post, Save, Hide, I replied", () => {
    expect(html).toMatch(/<footer[^>]*data-card-actions=""[^>]*>[\s\S]*<\/footer><\/article>$/);
    const actions = part(html, "data-card-actions");
    const labels = [
      ...actions.matchAll(/data-action="(\w+)"[^>]*>([\s\S]*?)<\/(?:a|button)>/g),
    ].map((m) => [m[1], visible(m[2]!)]);
    expect(labels).toEqual([
      ["open", "Open post (opens in a new tab)"],
      ["save", "Save"],
      ["hide", "Hide"],
      ["replied", "I replied"],
    ]);
  });

  it("opens the post in a new tab without an opener", () => {
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/www\.reddit\.com\/r\/SaaS\/comments\/abc123\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*data-action="open"/,
    );
  });

  it("keeps the reply tip and the disclosure next to Open post", () => {
    expect(html).toContain(REPLY_TIPS.looking_for_tool);
    const tip = html.indexOf(REPLY_TIPS.looking_for_tool);
    const disclosure = html.indexOf("Say you built it.");
    const open = html.indexOf('data-action="open"');
    expect(tip).toBeGreaterThan(html.indexOf("data-card-why"));
    expect(disclosure).toBeGreaterThan(0);
    expect(Math.max(tip, disclosure)).toBeLessThan(open);
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

describe("PostCard shows no author", () => {
  // A Bluesky link carries the poster's DID; the card may link to the post, never show who wrote it.
  const did = "did:plc:inventedmaker7q2x";
  const bluesky: FeedItem = {
    ...item,
    id: "00000000-0000-4000-8000-000000000002",
    source: "bluesky",
    community: "Bluesky",
    url: `https://bsky.app/profile/${did}/post/3lainventedkey`,
    excerpt: "Looking for an app that sends invoice reminders without me chasing anyone.",
    highlightStart: null,
    highlightEnd: null,
  };
  // Fields a careless loader might pass along. None may reach the card.
  const leaked = {
    ...bluesky,
    authorHash: "f00dfeedcafe1234",
    authorHandle: "invented-maker.bsky.social",
    author: "Invented Maker",
    username: "invented_maker",
    displayName: "Invented M.",
    avatarUrl: "https://cdn.example.test/invented-avatar.jpg",
  } as FeedItem;
  const html = renderToStaticMarkup(<PostCard item={leaked} now={NOW} setState={setState} />);
  const text = visible(html);

  it("renders no author field, even when one is passed in", () => {
    for (const value of [
      "f00dfeedcafe1234",
      "invented-maker",
      "Invented Maker",
      "invented_maker",
      "Invented M.",
      "invented-avatar",
    ])
      expect(html).not.toContain(value);
    expect(html).not.toMatch(/author|avatar|username|handle/i);
  });

  it("puts the poster's DID only in the link, never in the words on the card", () => {
    expect(html).toContain(`href="${bluesky.url}"`);
    expect(text).not.toContain(did);
    expect(text).not.toMatch(/(^|\s)@\w|\bu\/\w|bsky\.app|https?:/);
  });

  it("shows nothing but the source, time, our labels and reason, the excerpt and the actions", () => {
    const allowed = [
      "Bluesky",
      "Posted 3h ago",
      "84% match",
      CATEGORY_LABELS.looking_for_tool,
      "Why it matched:",
      bluesky.reason,
      bluesky.excerpt,
      "Reply tip",
      REPLY_TIPS.looking_for_tool,
      "Say you built it.",
      "Open post (opens in a new tab)",
      "Save",
      "Hide",
      "I replied",
    ];
    let rest = text;
    for (const piece of allowed) rest = rest.replace(piece, " ");
    expect(rest.replace(/[\s·]+/g, "")).toBe("");
  });
});

describe("PostActions", () => {
  const render = (state: FeedItem["state"]) =>
    renderToStaticMarkup(<PostActions id={item.id} state={state} setState={setState} />);
  const pressed = (markup: string) =>
    [...markup.matchAll(/data-action="(\w+)"[^>]*aria-pressed="(true|false)"/g)].map((m) => [
      m[1],
      m[2],
    ]);

  it("keeps every toggle on the card in every state, so focus never lands on a removed button", () => {
    for (const state of ["new", "saved", "replied", "hidden"] as const)
      expect(pressed(render(state)).map(([action]) => action)).toEqual(["save", "hide", "replied"]);
  });

  it("shows the post's state on its toggle, with an icon as well as color", () => {
    expect(pressed(render("new"))).toEqual([
      ["save", "false"],
      ["hide", "false"],
      ["replied", "false"],
    ]);
    expect(pressed(render("saved"))).toEqual([
      ["save", "true"],
      ["hide", "false"],
      ["replied", "false"],
    ]);
    expect(render("hidden")).toMatch(/data-action="hide"[^>]*aria-pressed="true"[^>]*><svg/);
    expect(render("new")).not.toContain("<svg");
  });

  it("presses a toggle to move the post there, and presses it again to move it back", () => {
    expect(nextState("new", "saved")).toBe("saved");
    expect(nextState("saved", "saved")).toBe("new");
    expect(nextState("saved", "replied")).toBe("replied");
    expect(nextState("hidden", "hidden")).toBe("new");
    expect(nextState("replied", "hidden")).toBe("hidden");
  });

  it("has one live status for what just happened", () => {
    expect(render("new").match(/role="status"/g)).toHaveLength(1);
    expect(render("new")).toContain('aria-live="polite"');
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
      expect(declared.has(url.hostname)).toBe(true);
      expect(href).not.toContain("chase payments & fees");
    }
    expect(html).toContain("Say you built it.");
    expect(html).toContain("r/freelance");
    expect(html).not.toContain("u_someone");
  });

  it("shows no subreddit link when Reddit search links are switched off", () => {
    const html = renderToStaticMarkup(
      <SearchLinksPanel
        terms={["late invoices"]}
        subreddits={["freelance"]}
        sources={linkSources().filter((s) => s.id !== "reddit_links")}
      />,
    );
    expect(html).not.toContain("r/freelance");
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

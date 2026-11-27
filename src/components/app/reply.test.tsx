import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// FirstRunRefresh asks the app router to re-render; a static render has none mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CATEGORY_LABELS, REPLY_TIPS } from "@/server/reply/tips";
import {
  activeFilterCount,
  clearFiltersHref,
  parseFeedParams,
  withEnabledSource,
  type FeedItem,
  type FeedSource,
} from "@/server/store/feed";
import { linkSources, sources } from "@/sources/registry";
import { subredditSearchLinks } from "@/sources/subreddit-links";
import { FeedError } from "./feed-error";
import { FirstRunProgress } from "./first-run-progress";
import { REFRESH_FOR_MS, refreshDelay } from "./first-run-refresh";
import { FilterBar } from "./filter-bar";
import { age, PostCard, sourceLine, unitRange } from "./post-card";
import { nextState, PostActions } from "./post-actions";
import { ReplyView } from "./reply-view";
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
  url: "https://www.reddit.com/r/SaaS/comments/invented1/",
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
      "Why it matched Looking for a tool Mentions Acme Invoices Asks for a tool that chases late invoices.",
    );
  });

  it("ends with one row of actions: View conversation, Save, Hide, I replied", () => {
    expect(html).toMatch(/<footer[^>]*data-card-actions=""[^>]*>[\s\S]*<\/footer><\/article>$/);
    const actions = part(html, "data-card-actions");
    const labels = [
      ...actions.matchAll(/data-action="(\w+)"[^>]*>([\s\S]*?)<\/(?:a|button)>/g),
    ].map((m) => [m[1], visible(m[2]!)]);
    expect(labels).toEqual([
      ["open", "View conversation (opens in a new tab)"],
      ["save", "Save"],
      ["hide", "Hide"],
      ["replied", "I replied"],
    ]);
  });

  it("opens the post in a new tab without an opener", () => {
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/www\.reddit\.com\/r\/SaaS\/comments\/invented1\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*data-action="open"/,
    );
  });

  it("puts the disclosure first in the row right above View conversation, with the reply tip beside it", () => {
    expect(html).toContain(REPLY_TIPS.looking_for_tool);
    // The last block before the actions: the disclosure, then the tip toggle, then the tip itself.
    const lastBlock = /<details[^>]*>([\s\S]*?)<\/details><footer[^>]*data-card-actions=""/.exec(
      html,
    );
    expect(lastBlock).not.toBeNull();
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(lastBlock![1]!)![1]!;
    expect(visible(summary)).toBe("Say you built it. Reply tip");
    expect(visible(lastBlock![1]!)).toContain(REPLY_TIPS.looking_for_tool);
    // View conversation is the first control after it.
    const footer = part(html, "data-card-actions");
    expect(footer.indexOf('data-action="open"')).toBeLessThan(footer.indexOf('data-action="save"'));
    expect(html.match(/Say you built it\./g)).toHaveLength(1);
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
      "Why it matched",
      bluesky.reason,
      bluesky.excerpt,
      "Reply tip",
      REPLY_TIPS.looking_for_tool,
      "Say you built it.",
      "View conversation (opens in a new tab)",
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

describe("active filters", () => {
  const count = (raw: Record<string, string>) => activeFilterCount(parseFeedParams(raw), 60);

  it("counts category, source, rival, search and a minimum match other than the default", () => {
    expect(count({})).toBe(0);
    expect(count({ category: "wish" })).toBe(1);
    expect(count({ category: "wish", source: "bluesky", q: "invoice" })).toBe(3);
    expect(count({ rival: "00000000-0000-4000-8000-0000000000c1", min: "70" })).toBe(2);
  });

  it("does not count the view, the page, the default minimum or a value it could not read", () => {
    expect(count({ view: "saved", page: "2" })).toBe(0);
    expect(count({ min: "60" })).toBe(0);
    expect(count({ source: "linkedin", min: "5", q: "   " })).toBe(0);
  });

  it("clears every filter but keeps the view", () => {
    const filter = parseFeedParams({ view: "saved", category: "wish", q: "invoice", page: "3" });
    expect(clearFiltersHref(filter)).toBe("/app/reply?view=saved");
    expect(clearFiltersHref(parseFeedParams({ source: "bluesky" }))).toBe("/app/reply");
  });
});

describe("FilterBar", () => {
  const rivals = [{ id: "00000000-0000-4000-8000-0000000000c1", name: "Acme Invoices" }];
  const render = (
    raw: Record<string, string>,
    sources: readonly FeedSource[] = ["hackernews", "bluesky"],
  ) =>
    renderToStaticMarkup(
      <FilterBar filter={parseFeedParams(raw)} defaultMin={60} rivals={rivals} sources={sources} />,
    );
  const html = render({ view: "saved", category: "wish", source: "bluesky", q: "invoice" });
  const options = (markup: string, name: string) =>
    [
      ...(new RegExp(`name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(markup)?.[1] ?? "").matchAll(
        /<option value="([^"]*)"/g,
      ),
    ].map((m) => m[1]);

  it("shows every filter with the current values, and keeps the view", () => {
    expect(html).toContain('name="view" value="saved"');
    expect(html).toMatch(/<option value="wish" selected="">Wish<\/option>/);
    expect(html).toMatch(/<option value="bluesky" selected="">Bluesky<\/option>/);
    expect(html).toContain("Acme Invoices");
    expect(html).toContain('value="60"');
    expect(html).toContain('value="invoice"');
  });

  it("shows how many filters are on", () => {
    const counts = [...html.matchAll(/<span[^>]*data-filter-count=""[^>]*>(\d+)</g)].map(
      (m) => m[1],
    );
    expect(counts.length).toBeGreaterThan(0);
    expect(new Set(counts)).toEqual(new Set(["3"]));
    expect(visible(html)).toContain("3 filters on");
    expect(visible(render({ category: "wish" }))).toContain("1 filter on");
  });

  it("lists each filter that is on, with a link that removes only that one", () => {
    const chips = [...html.matchAll(/<a[^>]*data-remove-filter[^>]*>/g)].map((m) => [
      /data-remove-filter="(\w+)"/.exec(m[0])![1],
      /href="([^"]+)"/.exec(m[0])![1]!.replaceAll("&amp;", "&"),
    ]);
    expect(chips).toEqual([
      ["category", "/app/reply?view=saved&source=bluesky&q=invoice"],
      ["source", "/app/reply?view=saved&category=wish&q=invoice"],
      ["q", "/app/reply?view=saved&category=wish&source=bluesky"],
    ]);
    expect(visible(html)).toContain("Category: Wish");
    expect(visible(html)).toContain("Source: Bluesky");
    expect(visible(html)).toContain("Search: invoice");
    expect(html).toMatch(/<a[^>]*href="\/app\/reply\?view=saved"[^>]*>Clear all<\/a>/);
  });

  it("names the rival and a minimum match other than the default", () => {
    const out = visible(render({ rival: rivals[0]!.id, min: "75" }));
    expect(out).toContain("Rival: Acme Invoices");
    expect(out).toContain("Minimum match: 75%");
  });

  it("shows no count, list or Clear all when no filter is on", () => {
    const none = render({ view: "all" });
    expect(none).not.toContain("data-remove-filter");
    expect(none).not.toContain("Clear all");
    expect(visible(none)).not.toMatch(/filters? on/);
  });

  it("offers only the sources that are switched on, so a source behind its gate is not shown", () => {
    expect(options(html, "source")).toEqual(["", "hackernews", "bluesky"]);
    expect(html).not.toMatch(/<option value="(reddit|x)"/);
  });

  it("never lists a source behind its gate, even when the address asks for it", () => {
    const out = render({ source: "reddit" });
    expect(options(out, "source")).toEqual(["", "hackernews", "bluesky"]);
    expect(out).not.toMatch(/Reddit/);
  });

  it("drops a source that is switched off from the filter before the feed is read", () => {
    const on: FeedSource[] = ["hackernews", "bluesky"];
    expect(withEnabledSource(parseFeedParams({ source: "reddit", category: "wish" }), on)).toEqual(
      parseFeedParams({ category: "wish" }),
    );
    expect(withEnabledSource(parseFeedParams({ source: "bluesky" }), on).source).toBe("bluesky");
  });

  it("leaves the source filter out when fewer than two sources are on", () => {
    expect(render({}, ["hackernews"])).not.toContain('name="source"');
  });

  it("works without JavaScript: a GET form to the Reply tab with a submit button", () => {
    const forms = [...html.matchAll(/<form[^>]*>/g)].map((m) => m[0]);
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form).toContain('method="get"');
      expect(form).toContain('action="/app/reply"');
    }
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Apply<\/button>/);
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

  it("says posts show as they are stored, and that the page updates itself", () => {
    const html = renderToStaticMarkup(
      <FirstRunProgress progress={[{ source: "reddit", status: "waiting" }]} />,
    );
    expect(visible(html)).toContain("Posts appear here as soon as we store them");
    expect(visible(html)).toContain("This page updates itself while we collect");
  });
});

describe("first run refresh (posts show as they are stored)", () => {
  it("checks often at first, then less often, then stops, so it never polls forever", () => {
    expect(refreshDelay(0)).toBe(15_000);
    expect(refreshDelay(9 * 60_000)).toBe(15_000);
    expect(refreshDelay(11 * 60_000)).toBe(60_000);
    expect(refreshDelay(REFRESH_FOR_MS - 1)).toBe(60_000);
    expect(refreshDelay(REFRESH_FOR_MS)).toBeNull();
    // Long enough for Reddit's vendor wait, which can run for two hours.
    expect(REFRESH_FOR_MS).toBeGreaterThanOrEqual(2 * 60 * 60_000);
  });
});

describe("ReplyView", () => {
  const items = Array.from({ length: 200 }, (_, i) => ({
    ...item,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    excerpt: `Invented post ${i}: is there a tool that chases late invoices for freelancers?`,
  }));
  const view = (
    raw: Record<string, string>,
    feed: { items: FeedItem[]; total: number; hasMore?: boolean },
  ) =>
    renderToStaticMarkup(
      <ReplyView
        filter={parseFeedParams(raw)}
        defaultMin={60}
        feed={{ hasMore: false, ...feed }}
        now={NOW}
        rivals={[]}
        sources={["hackernews", "bluesky"]}
        terms={["late invoices"]}
        subreddits={[]}
        links={[]}
        firstRun={null}
        setState={setState}
      />,
    );

  it("heads the column with the view and what it holds, then how many posts it has", () => {
    const out = visible(view({ view: "saved" }, { items: items.slice(0, 3), total: 3 }));
    expect(out).toContain("Saved Conversations you saved to come back to.");
    // Today is what we found in the last day, which can be an older post.
    expect(visible(view({}, { items: [], total: 0 }))).toContain(
      "Today Conversations worth a closer look: what we found in the last 24 hours that you have not replied to or hidden.",
    );
    expect(out).toContain("3 conversations, newest first.");
    expect(visible(view({ category: "wish" }, { items: items.slice(0, 1), total: 1 }))).toContain(
      "1 conversation matches these filters, newest first.",
    );
  });

  it("renders 200 cards, each a keyboard target, in one pass", () => {
    const started = performance.now();
    const out = view({ view: "all", page: "4" }, { items, total: 260, hasMore: true });
    // A generous bound for a server render; the browser target is in tests/e2e/reply.spec.ts.
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(out.match(/data-feed-card="true"/g)).toHaveLength(200);
    expect(out.match(/tabindex="-1"/g)).toHaveLength(200);
    expect(visible(out)).toContain("Showing 200 of 260");
    expect(out).toMatch(/<a[^>]*href="\/app\/reply\?view=all&amp;page=5"[^>]*>Load more<\/a>/);
  });

  it.each([
    ["today", "Nothing new today."],
    ["all", "No conversations to show yet."],
    ["saved", "Your saved conversations will appear here."],
    ["replied", "Conversations you mark as replied will appear here."],
    ["hidden", "Conversations you hide will appear here."],
  ])("says what to do next when %s is empty", (v, title) => {
    const out = view({ view: v }, { items: [], total: 0 });
    expect(visible(out)).toContain(title);
    expect(out).not.toContain("data-feed-card");
  });

  it("offers to clear the filters when they match nothing, keeping the view", () => {
    const out = view({ view: "saved", source: "bluesky" }, { items: [], total: 0 });
    expect(visible(out)).toContain("No conversations match these filters.");
    expect(out).toMatch(/<a[^>]*href="\/app\/reply\?view=saved"[^>]*>Clear filters<\/a>/);
  });
});

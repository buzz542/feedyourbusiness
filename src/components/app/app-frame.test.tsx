import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ViewCounts } from "@/lib/feed-views";
import { AppFrame } from "./app-frame";
import { currentNavItem, ViewNavList } from "./view-nav";

/**
 * The app frame (docs/PLAN.md 9.5): on wide screens a fixed side panel with Today, All, Saved,
 * Replied, Hidden and Settings; on narrow ones a top bar and a tab bar of the views. Invented data.
 */

const COUNTS: ViewCounts = { today: 12, all: 40, saved: 3, replied: 5, hidden: 2 };
/** The href of each link marked as the current page. */
const currentHrefs = (markup: string) =>
  [...markup.matchAll(/<a[^>]*aria-current="page"[^>]*>/g)].map(
    (m) => /href="([^"]+)"/.exec(m[0])![1],
  );
const links = (markup: string) =>
  [...markup.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [
    m[1]!.replaceAll("&amp;", "&"),
    m[2]!
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ]);

describe("currentNavItem", () => {
  it("reads the view from the address, with Today as the default", () => {
    expect(currentNavItem("/app/reply", null)).toBe("today");
    expect(currentNavItem("/app/reply", "saved")).toBe("saved");
    expect(currentNavItem("/app/reply", "hidden")).toBe("hidden");
    expect(currentNavItem("/app/reply", "nope")).toBe("today");
    expect(currentNavItem("/app/settings", null)).toBe("settings");
    expect(currentNavItem("/app/product", null)).toBe("product");
    expect(currentNavItem("/app/rivals", null)).toBeNull();
    expect(currentNavItem(null, null)).toBeNull();
  });
});

describe("ViewNavList", () => {
  const panel = renderToStaticMarkup(
    <ViewNavList variant="panel" current="saved" counts={COUNTS} />,
  );

  it("lists the views with their counts, then Product and Settings, each to its own address", () => {
    expect(links(panel)).toEqual([
      ["/app/reply", "Today 12 conversations"],
      ["/app/reply?view=all", "All conversations 40 conversations"],
      ["/app/reply?view=saved", "Saved 3 conversations"],
      ["/app/reply?view=replied", "Replied 5 conversations"],
      ["/app/reply?view=hidden", "Hidden 2 conversations"],
      ["/app/product", "Product"],
      ["/app/settings", "Settings"],
    ]);
  });

  it("marks only the current item, with aria-current and a bar, not color alone", () => {
    expect(currentHrefs(panel)).toEqual(["/app/reply?view=saved"]);
    expect(panel).toMatch(/aria-current="page"[^>]*>[\s\S]*?data-current-bar=""/);
  });

  it("says conversation, not conversations, for a count of one", () => {
    const out = renderToStaticMarkup(
      <ViewNavList variant="panel" current={null} counts={{ ...COUNTS, hidden: 1 }} />,
    );
    expect(links(out)).toContainEqual(["/app/reply?view=hidden", "Hidden 1 conversation"]);
  });

  it("marks Product on the product page", () => {
    const out = renderToStaticMarkup(
      <ViewNavList variant="panel" current="product" counts={COUNTS} />,
    );
    expect(currentHrefs(out)).toEqual(["/app/product"]);
  });

  it("marks Settings on the settings page", () => {
    const out = renderToStaticMarkup(
      <ViewNavList variant="panel" current="settings" counts={COUNTS} />,
    );
    expect(currentHrefs(out)).toEqual(["/app/settings"]);
  });

  it("shows the five views in the tab bar, without Settings, which sits in the top bar", () => {
    const bar = renderToStaticMarkup(<ViewNavList variant="bar" current="today" counts={COUNTS} />);
    expect(links(bar).map(([href]) => href)).toEqual([
      "/app/reply",
      "/app/reply?view=all",
      "/app/reply?view=saved",
      "/app/reply?view=replied",
      "/app/reply?view=hidden",
    ]);
  });

  it("shows no numbers before there is a product to count", () => {
    const out = renderToStaticMarkup(<ViewNavList variant="panel" current={null} counts={null} />);
    expect(links(out).map(([, text]) => text)).toEqual([
      "Today",
      "All conversations",
      "Saved",
      "Replied",
      "Hidden",
      "Product",
      "Settings",
    ]);
    expect(out).not.toContain("aria-current");
  });
});

describe("AppFrame", () => {
  const html = renderToStaticMarkup(
    <AppFrame productName="Invoicer" email="maker@example.test" counts={COUNTS} threshold={60}>
      <p>Feed</p>
    </AppFrame>,
  );

  it("puts the content in the main landmark the skip link points at", () => {
    expect(html).toMatch(/<main[^>]*id="main"[^>]*>[\s\S]*<p>Feed<\/p>/);
  });

  it("has a side panel for wide screens and a top bar and tab bar for narrow ones", () => {
    expect(html).toMatch(/<aside[^>]*class="[^"]*hidden[^"]*lg:flex/);
    expect(html).toMatch(/<header[^>]*class="[^"]*lg:hidden/);
    expect(html.match(/<nav[^>]*aria-label="Main"/g)).toHaveLength(2);
    expect(html).toContain("Invoicer");
    expect(html).toContain("Settings");
    expect(html).toContain('href="/app/product"');
  });

  it("keeps the legal links in reach", () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/remove-my-post"');
  });
});

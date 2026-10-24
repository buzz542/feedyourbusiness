import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, buttonClass } from "./button";
import { Card } from "./card";
import { Chip } from "./chip";
import { EmptyState } from "./empty-state";
import { Highlight } from "./highlight";
import { Sparkline } from "./sparkline";
import { Tabs } from "./tabs";

/** Render tests for the design system (docs/PLAN.md 9.4), with renderToStaticMarkup. */
const html = (node: React.ReactNode) => renderToStaticMarkup(node);

describe("Highlight", () => {
  const text = "Is there a tool that tracks invoices for freelancers?";

  it("wraps exactly the given range in <mark>", () => {
    const start = text.indexOf("a tool");
    const end = start + "a tool".length;
    expect(html(<Highlight text={text} start={start} end={end} />)).toBe(
      "Is there <mark>a tool</mark> that tracks invoices for freelancers?",
    );
  });

  it("can mark the very start and the very end", () => {
    expect(html(<Highlight text="abc" start={0} end={1} />)).toBe("<mark>a</mark>bc");
    expect(html(<Highlight text="abc" start={2} end={3} />)).toBe("ab<mark>c</mark>");
    expect(html(<Highlight text="abc" start={0} end={3} />)).toBe("<mark>abc</mark>");
  });

  it.each([
    ["no range", null, null],
    ["only a start", 1, null],
    ["only an end", null, 2],
    ["an empty range", 2, 2],
    ["a reversed range", 3, 1],
    ["a negative start", -1, 2],
    ["an end past the text", 1, 99],
    ["a start past the text", 99, 100],
    ["fractional offsets", 0.5, 2],
    ["NaN", Number.NaN, 2],
  ])("renders plain text, never a partial mark, for %s", (_label, start, end) => {
    expect(html(<Highlight text="abcdef" start={start} end={end} />)).toBe("abcdef");
  });

  it("never splits an emoji or other surrogate pair", () => {
    const t = "ok \u{1F600} go";
    // Offset 4 is inside the surrogate pair that starts at 3.
    expect(html(<Highlight text={t} start={4} end={6} />)).toBe(t);
    expect(html(<Highlight text={t} start={3} end={5} />)).toBe("ok <mark>\u{1F600}</mark> go");
  });

  it("never splits a surrogate pair at the end of the range either", () => {
    const t = "ok \u{1F600} go";
    // Offset 4 is inside the pair; marking 0 to 4 would leave a lone half on each side.
    expect(html(<Highlight text={t} start={0} end={4} />)).toBe(t);
  });

  it("escapes markup in the text", () => {
    expect(html(<Highlight text="<b>hi</b> there" start={10} end={15} />)).toBe(
      "&lt;b&gt;hi&lt;/b&gt; <mark>there</mark>",
    );
  });
});

describe("Button", () => {
  it("is a real button that does not submit forms by accident", () => {
    const out = html(<Button>Save</Button>);
    expect(out).toMatch(/^<button[^>]*type="button"[^>]*>Save<\/button>$/);
  });

  it("can submit when asked", () => {
    expect(html(<Button type="submit">Send</Button>)).toContain('type="submit"');
  });

  it("has three visibly different weights", () => {
    const classes = (["primary", "secondary", "quiet"] as const).map((v) => buttonClass(v));
    expect(new Set(classes).size).toBe(3);
    expect(buttonClass("primary")).toContain("bg-accent");
    expect(buttonClass("secondary")).toContain("border-rule");
  });

  it("passes disabled and other attributes through", () => {
    const out = html(
      <Button variant="secondary" disabled aria-label="Save post">
        Save
      </Button>,
    );
    expect(out).toMatch(/<button[^>]*\sdisabled=""/);
    expect(out).toContain('aria-label="Save post"');
    expect(html(<Button>Save</Button>)).not.toMatch(/\sdisabled=""/);
  });
});

describe("Chip", () => {
  it("renders its label", () => {
    expect(html(<Chip>Looking for a tool</Chip>)).toMatch(/<span[^>]*>Looking for a tool<\/span>/);
  });

  it("has an accent tone that differs from the default", () => {
    expect(html(<Chip tone="accent">Rival</Chip>)).not.toBe(html(<Chip>Rival</Chip>));
  });
});

describe("Card", () => {
  it("has a 1px rule border, square-ish corners and no shadow", () => {
    const out = html(<Card>Body</Card>);
    expect(out).toContain("border-rule");
    expect(out).toContain("rounded-[2px]");
    expect(out).not.toMatch(/shadow/);
  });

  it("can render as an article", () => {
    expect(html(<Card as="article">Body</Card>)).toMatch(/^<article/);
  });
});

describe("Tabs", () => {
  const items = [
    { href: "/app/reply", label: "Reply" },
    { href: "/app/rivals", label: "Rivals" },
    { href: "/app/build", label: "Build" },
  ];

  it("renders a labeled navigation with one link per tab, each to its own page", () => {
    const out = html(<Tabs label="Main" items={items} current="/app/reply" />);
    expect(out).toMatch(/^<nav aria-label="Main"/);
    expect(
      [...out.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]),
    ).toEqual([
      ["/app/reply", "Reply"],
      ["/app/rivals", "Rivals"],
      ["/app/build", "Build"],
    ]);
  });

  it("marks only the current tab with aria-current", () => {
    const out = html(<Tabs label="Main" items={items} current="/app/rivals" />);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/<a[^>]*aria-current="page"[^>]*>Rivals<\/a>/);
  });

  it("treats a nested path as inside its tab, without calling the tab the current page", () => {
    const out = html(<Tabs label="Main" items={items} current="/app/reply/saved" />);
    expect(out).toMatch(/<a[^>]*aria-current="true"[^>]*>Reply<\/a>/);
    expect(out).not.toContain('aria-current="page"');
  });

  it("does not match a tab by a shared prefix alone", () => {
    const out = html(<Tabs label="Main" items={items} current="/app/replyx" />);
    expect(out).not.toContain("aria-current");
  });
});

describe("EmptyState", () => {
  it("says what happened and what to do next", () => {
    const out = html(
      <EmptyState title="No posts yet" action={<a href="/app/settings">Add terms</a>}>
        Try adding search terms or lowering the match threshold.
      </EmptyState>,
    );
    expect(out).toContain("No posts yet");
    expect(out).toContain("Try adding search terms");
    expect(out).toContain('<a href="/app/settings">Add terms</a>');
  });
});

describe("Sparkline", () => {
  const points = (out: string) => /points="([^"]*)"/.exec(out)?.[1] ?? "";

  it("draws one point per value as an accessible inline SVG", () => {
    const out = html(<Sparkline values={[1, 4, 2, 8]} label="Complaints, last 8 weeks" />);
    expect(out).toMatch(/^<svg[^>]*role="img"[^>]*aria-label="Complaints, last 8 weeks"/);
    expect(points(out).split(" ")).toHaveLength(4);
  });

  const xy = (out: string) =>
    points(out)
      .split(" ")
      .map((p) => p.split(",").map(Number) as [number, number]);

  it("puts the largest value at the top and the smallest at the bottom", () => {
    const out = html(<Sparkline values={[0, 10]} label="x" width={100} height={20} />);
    const [first, last] = xy(out);
    expect(first![1]).toBeGreaterThan(last![1]);
  });

  it("runs oldest to newest, left to right, and stays inside the box", () => {
    const out = html(<Sparkline values={[3, 1, 4, 1, 5]} label="x" width={100} height={20} />);
    const pts = xy(out);
    for (let i = 1; i < pts.length; i++) expect(pts[i]![0]).toBeGreaterThan(pts[i - 1]![0]);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(20);
    }
  });

  it("shows a single value as a dot", () => {
    const out = html(<Sparkline values={[5]} label="x" />);
    expect(out).toContain("<circle");
    expect(out).not.toContain("<polyline");
  });

  it.each([
    ["no values", []],
    ["one value", [5]],
    ["all equal values", [3, 3, 3]],
    ["all zeros", [0, 0, 0, 0]],
  ])("never draws NaN or Infinity for %s", (_label, values) => {
    const out = html(<Sparkline values={values} label="x" />);
    expect(out).not.toMatch(/NaN|Infinity/);
  });

  it("skips values that are not finite numbers but keeps their slot on the time axis", () => {
    const out = html(<Sparkline values={[1, Number.NaN, 3, Infinity]} label="x" width={98} />);
    expect(out).not.toMatch(/NaN|Infinity/);
    // Four slots across 2..96: 2, 33.3, 64.7, 96. The value 3 stays in slot three.
    expect(xy(out).map(([x]) => x)).toEqual([2, 64.7]);
  });
});

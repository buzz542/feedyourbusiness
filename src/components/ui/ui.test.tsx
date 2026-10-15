import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Card } from "./card";
import { Chip } from "./chip";
import { EmptyState } from "./empty-state";
import { findHighlight, Highlight } from "./highlight";
import { Skeleton } from "./skeleton";
import { Sparkline } from "./sparkline";
import { Tabs } from "./tabs";
import { Tag } from "./tag";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Highlight", () => {
  const text = "Anyone know a tool for invoice reminders?";

  it("wraps exactly the given range in <mark>", () => {
    const out = html(<Highlight text={text} start={23} end={40} />);
    expect(out).toMatch(/^Anyone know a tool for <mark[^>]*>invoice reminders<\/mark>\?$/);
  });

  it("highlights from the start and to the end", () => {
    expect(html(<Highlight text="abcdef" start={0} end={2} />)).toMatch(
      /^<mark[^>]*>ab<\/mark>cdef$/,
    );
    expect(html(<Highlight text="abcdef" start={4} end={6} />)).toMatch(
      /^abcd<mark[^>]*>ef<\/mark>$/,
    );
  });

  it.each([
    [null, null],
    [-1, 3],
    [2, 99],
    [4, 4],
    [5, 2],
    [1.5, 3],
    [Number.NaN, 3],
  ])("renders plain text for unusable offsets (%s, %s)", (start, end) => {
    expect(html(<Highlight text="abcdef" start={start} end={end} />)).toBe("abcdef");
  });

  it("counts characters, not UTF-16 units, so emoji never split a highlight", () => {
    const out = html(<Highlight text="🙂 need a CRM" start={2} end={6} />);
    expect(out).toMatch(/^🙂 <mark[^>]*>need<\/mark> a CRM$/);
  });

  it("escapes markup in the text", () => {
    expect(html(<Highlight text="<b>hi</b>" start={null} end={null} />)).toBe(
      "&lt;b&gt;hi&lt;/b&gt;",
    );
  });

  it("uses the highlight token and never animates", () => {
    const out = html(<Highlight text="abc" start={0} end={1} />);
    expect(out).toContain("bg-highlight");
    expect(out).not.toMatch(/animate|transition/);
  });
});

describe("findHighlight", () => {
  it.each([
    ["Anyone know a tool for invoice reminders?", "invoice reminders"],
    ["🙂🙂 need a CRM that syncs", "a CRM"],
    ["été: looking for a tool", "looking"],
  ])("round-trips through Highlight in %j", (text, phrase) => {
    const range = findHighlight(text, phrase);
    expect(range).not.toBeNull();
    const out = html(<Highlight text={text} start={range!.start} end={range!.end} />);
    expect(out).toContain(`>${phrase}</mark>`);
  });

  it("returns null when there is no exact match or nothing to find", () => {
    expect(findHighlight("abc", "x")).toBeNull();
    expect(findHighlight("abc", "")).toBeNull();
    expect(findHighlight("abc", "ABC")).toBeNull();
  });
});

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    expect(html(<Button>Save</Button>)).toMatch(/^<button[^>]*type="button"[^>]*>Save<\/button>$/);
  });

  it("can be a submit button", () => {
    expect(html(<Button type="submit">Go</Button>)).toContain('type="submit"');
  });

  it("has three visibly different weights", () => {
    const primary = html(<Button variant="primary">A</Button>);
    const secondary = html(<Button variant="secondary">A</Button>);
    const quiet = html(<Button variant="quiet">A</Button>);
    expect(primary).toContain("bg-accent");
    expect(secondary).toContain("border-rule-strong");
    expect(quiet).not.toContain("bg-accent");
    expect(quiet).not.toContain("border-rule-strong");
  });

  it("renders a link when given an href", () => {
    const out = html(
      <Button href="/app/settings" variant="secondary">
        Settings
      </Button>,
    );
    expect(out).toMatch(/^<a[^>]*href="\/app\/settings"[^>]*>Settings<\/a>$/);
  });

  it("passes link attributes through", () => {
    const out = html(
      <Button href="/terms" target="_blank" aria-label="Read the terms">
        Terms
      </Button>,
    );
    expect(out).toContain('target="_blank"');
    expect(out).toContain('aria-label="Read the terms"');
  });

  it("gives the quiet variant its own padding, not the others'", () => {
    expect(html(<Button variant="quiet">A</Button>)).not.toContain("px-4");
  });

  it("passes disabled and aria attributes through", () => {
    const out = html(
      <Button disabled aria-describedby="x">
        Wait
      </Button>,
    );
    expect(out).toContain("disabled");
    expect(out).toContain('aria-describedby="x"');
  });
});

describe("Chip", () => {
  it("renders its label with square-ish corners", () => {
    const out = html(<Chip>invoice tool</Chip>);
    expect(out).toContain("invoice tool");
    expect(out).toContain("rounded-[2px]");
  });

  it("shows the pressed state to assistive tech when it is a toggle", () => {
    expect(html(<Chip pressed>Reddit</Chip>)).toMatch(/<button[^>]*aria-pressed="true"/);
    expect(html(<Chip pressed={false}>Reddit</Chip>)).toMatch(/<button[^>]*aria-pressed="false"/);
  });
});

describe("Card", () => {
  it("has a 1px rule border, 2px corners and no shadow", () => {
    const out = html(<Card>Body</Card>);
    expect(out).toContain("border-rule");
    expect(out).toContain("rounded-[2px]");
    expect(out).not.toMatch(/shadow/);
    expect(out).toContain("Body");
  });

  it("can render as a list item", () => {
    expect(html(<Card as="li">x</Card>)).toMatch(/^<li/);
  });
});

describe("Tag", () => {
  it("renders a small label", () => {
    expect(html(<Tag>Looking for a tool</Tag>)).toContain("Looking for a tool");
  });
});

describe("Tabs", () => {
  const items = [
    { href: "/app/reply", label: "Reply" },
    { href: "/app/rivals", label: "Rivals" },
    { href: "/app/build", label: "Build" },
  ];

  it("marks only the current tab with aria-current", () => {
    const out = html(<Tabs label="Sections" items={items} current="/app/rivals" />);
    expect(out).toContain('aria-label="Sections"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(
      /<a[^>]*href="\/app\/rivals"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/app\/rivals"/,
    );
  });

  it("uses a top border and no bottom border when filling a bottom bar", () => {
    const out = html(<Tabs label="Sections" items={items} current="/app/reply" fill />);
    expect(out).toContain("border-t-2");
    expect(out).not.toContain("border-b-2");
    expect(out).not.toContain("border-b-0");
  });

  it("treats a nested path as inside its tab", () => {
    const out = html(<Tabs label="Sections" items={items} current="/app/reply/123" />);
    expect(out).toMatch(
      /href="\/app\/reply"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/app\/reply"/,
    );
  });
});

describe("EmptyState", () => {
  it("says what happened and what to do next", () => {
    const out = html(
      <EmptyState
        title="Nothing new today"
        body="Lower the match threshold or open the search links."
        action={<a href="/app/settings">Open settings</a>}
      />,
    );
    expect(out).toContain("Nothing new today");
    expect(out).toContain("Lower the match threshold");
    expect(out).toContain("Open settings");
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech and announces loading once", () => {
    const out = html(<Skeleton cards={3} label="Loading posts" />);
    expect(out).toContain('aria-hidden="true"');
    expect(out.match(/Loading posts/g)).toHaveLength(1);
    expect(out).toContain('role="status"');
  });
});

describe("Sparkline", () => {
  it("draws one point per value with an accessible summary", () => {
    const out = html(<Sparkline values={[1, 4, 2, 6]} label="Complaints over 8 weeks" />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Complaints over 8 weeks"');
    const points = /points="([^"]+)"/.exec(out)?.[1]?.trim().split(/\s+/) ?? [];
    expect(points).toHaveLength(4);
  });

  it.each([[[]], [[5]], [[0, 0, 0]], [[3, 3]]])("never emits NaN for %j", (values) => {
    const out = html(<Sparkline values={values} label="Trend" />);
    expect(out).not.toMatch(/NaN|Infinity/);
  });

  it("puts higher values higher on the chart", () => {
    const out = html(<Sparkline values={[0, 10]} label="Trend" width={100} height={20} />);
    const [a, b] = (/points="([^"]+)"/.exec(out)?.[1] ?? "").trim().split(/\s+/);
    expect(Number(b!.split(",")[1])).toBeLessThan(Number(a!.split(",")[1]));
  });
});

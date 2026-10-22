import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  ButtonLink,
  Card,
  Chip,
  EmptyState,
  Highlight,
  Skeleton,
  Sparkline,
  Tabs,
  Tag,
} from "./index";

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("Highlight", () => {
  const text = "Anyone know a tool for invoice reminders?";

  it("wraps exactly the given range in <mark>", () => {
    expect(html(<Highlight text={text} start={14} end={18} />)).toBe(
      'Anyone know a <mark class="rounded-[1px] px-0.5">tool</mark> for invoice reminders?',
    );
  });

  it("can mark the whole text, the start or the end", () => {
    expect(html(<Highlight text="abc" start={0} end={3} />)).toMatch(/^<mark[^>]*>abc<\/mark>$/);
    expect(html(<Highlight text="abc" start={0} end={1} />)).toMatch(/^<mark[^>]*>a<\/mark>bc$/);
    expect(html(<Highlight text="abc" start={2} end={3} />)).toMatch(/^ab<mark[^>]*>c<\/mark>$/);
  });

  it.each([
    ["no offsets", undefined, undefined],
    ["null offsets", null, null],
    ["only a start", 2, null],
    ["a negative start", -1, 4],
    ["an end past the text", 0, 999],
    ["an empty range", 5, 5],
    ["an inverted range", 8, 3],
    ["fractional offsets", 1.5, 4],
    ["NaN", Number.NaN, 4],
  ])("renders plain text for %s", (_label, start, end) => {
    expect(html(<Highlight text={text} start={start} end={end} />)).toBe(text);
  });

  it("escapes the text", () => {
    expect(html(<Highlight text="<b>hi</b>" start={0} end={3} />)).not.toContain("<b>");
  });
});

describe("Button", () => {
  it("is type=button by default and uses the primary weight", () => {
    const out = html(<Button>Save</Button>);
    expect(out).toContain('type="button"');
    expect(out).toContain("bg-accent");
    expect(out).toContain(">Save</button>");
  });

  it("has secondary and quiet weights", () => {
    expect(html(<Button variant="secondary">x</Button>)).toContain("border-rule");
    expect(html(<Button variant="quiet">x</Button>)).toContain("text-accent");
  });

  it("passes through submit and disabled", () => {
    const out = html(
      <Button type="submit" disabled>
        Go
      </Button>,
    );
    expect(out).toContain('type="submit"');
    expect(out).toContain("disabled");
  });

  it("ButtonLink renders a link", () => {
    expect(html(<ButtonLink href="/app/billing">Start</ButtonLink>)).toMatch(
      /^<a [^>]*href="\/app\/billing"[^>]*>Start<\/a>$/,
    );
  });
});

describe("Chip and Tag", () => {
  it("marks a selected chip", () => {
    expect(html(<Chip selected>Pricing</Chip>)).toContain('data-selected="true"');
    expect(html(<Chip>Pricing</Chip>)).not.toContain("data-selected");
  });

  it("Tag renders its text", () => {
    expect(html(<Tag>Wish</Tag>)).toContain(">Wish</span>");
  });
});

describe("Card and Skeleton", () => {
  it("Card has a rule border, square corners and no shadow", () => {
    const out = html(<Card>hello</Card>);
    expect(out).toMatch(/^<article [^>]*border border-rule/);
    expect(out).toContain("rounded-[2px]");
    expect(out).not.toContain("shadow");
  });

  it("Skeleton is hidden from assistive tech and renders the given lines", () => {
    const out = html(<Skeleton lines={4} />);
    expect(out).toContain('aria-hidden="true"');
    expect(out.match(/animate-pulse/g)).toHaveLength(4);
  });
});

describe("Tabs", () => {
  const items = [
    { href: "/app/reply", label: "Reply" },
    { href: "/app/rivals", label: "Rivals" },
    { href: "/app/build", label: "Build" },
  ];

  it("marks only the current tab", () => {
    const out = html(<Tabs items={items} current="/app/rivals" label="Sections" />);
    expect(out).toContain('aria-label="Sections"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(
      /<a [^>]*href="\/app\/rivals"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*href="\/app\/rivals"/,
    );
  });

  it("marks none when nothing matches", () => {
    expect(html(<Tabs items={items} current={null} label="Sections" />)).not.toContain(
      "aria-current",
    );
  });
});

describe("EmptyState", () => {
  it("shows the title, the next step and the action", () => {
    const out = html(
      <EmptyState title="No posts yet" action={<a href="/app/settings">Add terms</a>}>
        Add search terms or lower the threshold.
      </EmptyState>,
    );
    expect(out).toContain("<h2");
    expect(out).toContain("No posts yet");
    expect(out).toContain("Add search terms or lower the threshold.");
    expect(out).toContain('href="/app/settings"');
  });

  it("omits empty slots", () => {
    expect(html(<EmptyState title="Nothing here" />)).toBe(
      html(<EmptyState title="Nothing here">{null}</EmptyState>),
    );
  });
});

describe("Sparkline", () => {
  const points = (out: string) =>
    (/points="([^"]*)"/.exec(out)?.[1] ?? "").split(" ").map((p) => p.split(",").map(Number));

  it("is an image with a text label", () => {
    const out = html(<Sparkline values={[1, 3, 2]} label="Complaints: 1, 3, 2" />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Complaints: 1, 3, 2"');
  });

  it("plots one point per value, higher values higher, inside the box", () => {
    const pts = points(html(<Sparkline values={[0, 10, 5]} label="x" width={80} height={20} />));
    expect(pts).toHaveLength(3);
    const ys = pts.map((p) => p[1]!);
    expect(ys[1]!).toBeLessThan(ys[2]!);
    expect(ys[2]!).toBeLessThan(ys[0]!);
    for (const [x, y] of pts) {
      expect(x!).toBeGreaterThanOrEqual(0);
      expect(x!).toBeLessThanOrEqual(80);
      expect(y!).toBeGreaterThanOrEqual(0);
      expect(y!).toBeLessThanOrEqual(20);
    }
  });

  it("draws a flat line for equal values and survives one value or bad numbers", () => {
    const flat = points(html(<Sparkline values={[4, 4, 4]} label="x" height={20} />));
    expect(new Set(flat.map((p) => p[1]))).toEqual(new Set([10]));
    expect(points(html(<Sparkline values={[7]} label="x" />))).toHaveLength(1);
    expect(html(<Sparkline values={[1, Number.NaN, Infinity]} label="x" />)).not.toMatch(
      /NaN|Infinity/,
    );
  });

  it("renders nothing for no values", () => {
    expect(html(<Sparkline values={[]} label="x" />)).toBe("");
  });
});

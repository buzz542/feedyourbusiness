import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { walk } from "../../../compliance/lib/finding";

/**
 * WCAG 2.2 AA (docs/PLAN.md 9.2): every text pair the UI uses reaches 4.5:1 in both themes, and
 * every control edge and focus or current-item mark reaches 3:1 (1.4.11), computed from the token
 * values in globals.css, so a token change that breaks contrast fails here. Dark mode is designed
 * on its own, not by inverting the light palette; the elevation tests below hold it to that.
 */

const css = readFileSync("src/app/globals.css", "utf8");

function block(source: string, opener: RegExp): string {
  const start = source.search(opener);
  if (start < 0) throw new Error(`block not found: ${opener}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unclosed block: ${opener}`);
}

function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]!] = m[2]!;
  return out;
}

const light = tokens(block(css, /^:root\s*\{/m));
const dark = tokens(block(block(css, /@media \(prefers-color-scheme: dark\)/), /:root\s*\{/));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * [text, background]: every combination the components render. Backgrounds: --paper (the page),
 * --panel (the app's side panel and bars), --surface (cards, fields, menus), --selected (the
 * current item in a navigation) and --accent-fill (primary buttons). Text: --ink, --ink-muted,
 * --accent (links), --accent-ink (on primary buttons), --positive and --negative (trends).
 */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ink", "paper"],
  ["ink", "panel"],
  ["ink", "surface"],
  ["ink", "selected"],
  ["ink-muted", "paper"],
  ["ink-muted", "panel"],
  ["ink-muted", "surface"],
  ["ink-muted", "selected"],
  ["accent", "paper"],
  ["accent", "panel"],
  ["accent", "surface"],
  ["accent", "selected"],
  ["accent-ink", "accent-fill"],
  ["ink", "highlight"],
  ["positive", "paper"],
  ["positive", "surface"],
  ["negative", "paper"],
  ["negative", "surface"],
];

/**
 * [mark, background] at 3:1 (WCAG 2.2, 1.4.11): --control is the edge of fields and buttons;
 * --accent is the focus outline and the bar on the current navigation item; --accent-fill is
 * the edge of a primary button.
 */
const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["control", "paper"],
  ["control", "panel"],
  ["control", "surface"],
  ["accent", "paper"],
  ["accent", "panel"],
  ["accent", "surface"],
  ["accent", "selected"],
  ["accent-fill", "paper"],
  ["accent-fill", "surface"],
];

const both = (pairs: ReadonlyArray<readonly [string, string]>) =>
  pairs.flatMap(([fg, bg]) => [["light", fg, bg] as const, ["dark", fg, bg] as const]);

describe("color tokens", () => {
  it("defines every token in both themes", () => {
    const names = new Set([...TEXT_PAIRS.flat(), ...NON_TEXT_PAIRS.flat(), "rule"]);
    for (const name of names) {
      expect(light[name], `light --${name}`).toMatch(/^#/);
      expect(dark[name], `dark --${name}`).toMatch(/^#/);
    }
  });

  it("uses the highlight colors from the plan", () => {
    expect(light.highlight?.toLowerCase()).toBe("#f3dd6d");
    expect(dark.highlight?.toLowerCase()).toBe("#6b5a12");
  });

  it.each(both(TEXT_PAIRS))("%s theme: text --%s on --%s is at least 4.5:1", (theme, fg, bg) => {
    const t = theme === "light" ? light : dark;
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(both(NON_TEXT_PAIRS))("%s theme: --%s against --%s is at least 3:1", (theme, fg, bg) => {
    const t = theme === "light" ? light : dark;
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });

  it("the contrast math is right (black on white is 21:1, a failing pair is caught)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // Muted text on the dark highlight is too faint, which is why highlighted text is always ink.
    expect(contrast(dark["ink-muted"]!, dark.highlight!)).toBeLessThan(4.5);
    // Light text on the dark theme's link color fails, which is why buttons use --accent-fill.
    expect(contrast(dark["accent-ink"]!, dark.accent!)).toBeLessThan(4.5);
  });
});

describe("dark mode is designed, not inverted", () => {
  const lum = (t: Record<string, string>, name: string) => luminance(t[name]!);

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)(
    "%s theme: cards sit above the page and the side panel sits below it",
    (_theme, t) => {
      // An inverted palette would flip this order in the dark theme.
      expect(lum(t, "surface")).toBeGreaterThan(lum(t, "paper"));
      expect(lum(t, "panel")).toBeLessThan(lum(t, "paper"));
    },
  );

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme: primary buttons keep light text on an ink-blue fill", (_theme, t) => {
    expect(lum(t, "accent-ink")).toBeGreaterThan(lum(t, "accent-fill"));
    const hex = t["accent-fill"]!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(b!).toBeGreaterThan(Math.max(r!, g!));
  });

  it("swaps no value between ink and paper", () => {
    expect(dark.paper).not.toBe(light.ink);
    expect(dark.ink).not.toBe(light.paper);
    expect(dark["accent-ink"]).not.toBe(dark.paper);
  });
});

describe("where the tokens are used", () => {
  const ui = [...walk("src/app"), ...walk("src/components"), ...walk("emails")]
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));

  /** Every class string (a quoted run) that names a given utility. */
  const classStrings = (source: string, utility: RegExp) =>
    [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)]
      .map((m) => m[1] ?? m[2] ?? "")
      .filter((s) => utility.test(s));

  it("puts text-accent-ink only on bg-accent-fill, never on the link color", () => {
    const wrong = ui.flatMap(({ file, source }) =>
      classStrings(source, /\btext-accent-ink\b/)
        .filter((s) => !/\bbg-accent-fill\b/.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(wrong).toEqual([]);
  });

  it("catches a planted text-accent-ink on bg-accent", () => {
    const planted = classStrings('<a className="bg-accent text-accent-ink">Go</a>', /accent-ink/);
    expect(planted.filter((s) => !/\bbg-accent-fill\b/.test(s))).toHaveLength(1);
  });
});

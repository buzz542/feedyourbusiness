import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Design tokens meet WCAG 2.2 AA (docs/PLAN.md 9.2): at least 4.5:1 for every text pair and 3:1 for
 * control borders and the focus ring, in both themes. Computed from the values in globals.css, so a
 * token change that breaks contrast fails here.
 */

const css = readFileSync("src/app/globals.css", "utf8");

function block(source: string, start: number): string {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced braces in globals.css");
}

function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi))
    out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

const light = tokens(block(css, css.indexOf(":root")));
const darkMedia = block(css, css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = tokens(block(darkMedia, darkMedia.indexOf(":root")));

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Foreground, background. Every text color is checked on every surface it appears on. */
const TEXT_PAIRS = [
  ["ink", "paper"],
  ["ink-muted", "paper"],
  ["accent", "paper"],
  ["accent-ink", "accent"],
  ["ink", "highlight"],
  ["positive", "paper"],
  ["negative", "paper"],
  ["ink", "paper-sunk"],
  ["ink-muted", "paper-sunk"],
  ["accent", "paper-sunk"],
  ["positive", "paper-sunk"],
  ["negative", "paper-sunk"],
] as const;

/** Borders that identify a control (inputs, checkboxes) and the focus outline: 3:1 (WCAG 1.4.11). */
const NON_TEXT_PAIRS = [
  ["rule-strong", "paper"],
  ["rule-strong", "paper-sunk"],
  ["accent", "paper"],
] as const;

describe("design tokens", () => {
  it("parses both themes with the same token names", () => {
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("uses the highlighter colors from the plan", () => {
    expect(light.highlight).toBe("#f3dd6d");
    expect(dark.highlight).toBe("#6b5a12");
  });

  it("computes contrast correctly", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const [theme, t] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it.each(TEXT_PAIRS)(`${theme}: %s on %s is at least 4.5:1`, (fg, bg) => {
      expect(t[fg], fg).toBeDefined();
      expect(t[bg], bg).toBeDefined();
      expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(NON_TEXT_PAIRS)(`${theme}: %s on %s is at least 3:1`, (fg, bg) => {
      expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3);
    });
  }
});

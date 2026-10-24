import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AA (docs/PLAN.md 9.2): every text pair the UI uses reaches 4.5:1 in both themes,
 * computed from the token values in globals.css, so a token change that breaks contrast fails here.
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

/** [text, background]: every combination the components render. */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ink", "paper"],
  ["ink-muted", "paper"],
  ["accent", "paper"],
  ["accent-ink", "accent"],
  ["ink", "highlight"],
  ["positive", "paper"],
  ["negative", "paper"],
];

describe("color tokens", () => {
  it("defines every token in both themes", () => {
    const names = new Set(TEXT_PAIRS.flat());
    for (const name of names) {
      expect(light[name], `light --${name}`).toMatch(/^#/);
      expect(dark[name], `dark --${name}`).toMatch(/^#/);
    }
  });

  it("uses the highlight colors from the plan", () => {
    expect(light.highlight?.toLowerCase()).toBe("#f3dd6d");
    expect(dark.highlight?.toLowerCase()).toBe("#6b5a12");
  });

  it.each(
    TEXT_PAIRS.flatMap(([fg, bg]) => [["light", fg, bg] as const, ["dark", fg, bg] as const]),
  )("%s theme: --%s on --%s is at least 4.5:1", (theme, fg, bg) => {
    const t = theme === "light" ? light : dark;
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("the contrast math is right (black on white is 21:1, a failing pair is caught)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // Muted text on the dark highlight is too faint, which is why highlighted text is always ink.
    expect(contrast(dark["ink-muted"]!, dark.highlight!)).toBeLessThan(4.5);
  });
});
